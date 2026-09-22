-- Stop deleted invoice lines being charged against the invoice.
--
-- The summary takes sales from invoice_items but cost from
-- invoice_item_financials, and nothing ever removed a cost row when its line
-- was deleted. Editing an invoice deletes and recreates every line, so each
-- edit that dropped or swapped a line left its cost behind, counted forever.
--
-- INV--01191 is the visible case: eight cost rows against seven lines, so a
-- ₱19,500 cabinet's cost was subtracted from revenue that no longer included
-- it. Every line on it is profitable, yet it reported a ₱9,887.71 loss.
-- Across the business this was 31 rows on 27 invoices, ₱69,306.18 of cost —
-- profit understated by that much.

-- ---------------------------------------------------------------------------
-- 1. A line's cost row goes when the line does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drop_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.invoice_item_financials f
  WHERE f.invoice_item_id = OLD.id
     -- Rows written before lines were linked have no invoice_item_id, so fall
     -- back to the key they were stored under. Only ever one such row: that
     -- combination is unique per invoice.
     OR (
       f.invoice_item_id IS NULL
       AND f.invoice_id = OLD.invoice_id
       AND f.item_id IS NOT DISTINCT FROM OLD.item_id
       AND f.variation_id IS NOT DISTINCT FROM OLD.variation_id
     );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_drop_invoice_item_cost ON public.invoice_items;
CREATE TRIGGER trg_drop_invoice_item_cost
AFTER DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.drop_invoice_item_cost();

-- ---------------------------------------------------------------------------
-- 2. Clear out the rows already stranded.
-- ---------------------------------------------------------------------------
DELETE FROM public.invoice_item_financials f
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_items li
  WHERE li.invoice_id = f.invoice_id
    AND li.item_id IS NOT DISTINCT FROM f.item_id
    AND li.variation_id IS NOT DISTINCT FROM f.variation_id
);

-- ---------------------------------------------------------------------------
-- 3. The roll-up refuses to count a cost row with no line behind it, so a
--    stray row can never again move an invoice's profit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_invoice_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_profit NUMERIC := 0;
  v_margin NUMERIC := 0;
BEGIN
  IF NEW.status NOT IN ('paid', 'completed') THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_sales
    FROM public.invoice_items WHERE invoice_id = NEW.id;

  -- Cost and sales are now counted over the same set of lines.
  SELECT COALESCE(SUM(f.line_total_cost), 0) INTO v_cost
    FROM public.invoice_item_financials f
    WHERE f.invoice_id = NEW.id
      AND f.line_total_cost IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.invoice_items li
        WHERE li.invoice_id = f.invoice_id
          AND li.item_id IS NOT DISTINCT FROM f.item_id
          AND li.variation_id IS NOT DISTINCT FROM f.variation_id
      );

  v_profit := v_sales - v_cost;
  IF v_sales > 0 THEN v_margin := (v_profit / v_sales) * 100; ELSE v_margin := 0; END IF;

  INSERT INTO public.invoice_financials
    (invoice_id, total_sales, total_cost, total_profit, profit_margin, paid_at)
  VALUES
    (NEW.id, v_sales, v_cost, v_profit, v_margin, now())
  ON CONFLICT (invoice_id) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_cost = EXCLUDED.total_cost,
    total_profit = EXCLUDED.total_profit,
    profit_margin = EXCLUDED.profit_margin,
    paid_at = COALESCE(invoice_financials.paid_at, EXCLUDED.paid_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Restate every settled invoice from what its lines actually say. The
--    roll-up only fires on a status change, so the stale figures would
--    otherwise sit there until each invoice happened to be touched again.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT
    i.id AS invoice_id,
    COALESCE((SELECT SUM(li.quantity * li.unit_price)
                FROM public.invoice_items li WHERE li.invoice_id = i.id), 0) AS sales,
    COALESCE((SELECT SUM(f.line_total_cost)
                FROM public.invoice_item_financials f
               WHERE f.invoice_id = i.id AND f.line_total_cost IS NOT NULL), 0) AS cost
  FROM public.invoices i
  WHERE i.status IN ('paid', 'completed')
)
UPDATE public.invoice_financials fin
SET total_sales  = t.sales,
    total_cost   = t.cost,
    total_profit = t.sales - t.cost,
    profit_margin = CASE WHEN t.sales > 0
                         THEN ((t.sales - t.cost) / t.sales) * 100 ELSE 0 END,
    updated_at = now()
FROM totals t
WHERE fin.invoice_id = t.invoice_id;
