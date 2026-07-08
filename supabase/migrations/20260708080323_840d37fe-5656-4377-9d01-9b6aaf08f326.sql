
-- Backfill per-line cost snapshots for every existing invoice line that has an item_id.
-- Uses the item's current cost_price as the snapshot (best available for historical rows).
INSERT INTO public.invoice_item_financials
  (invoice_id, item_id, variation_id, cost_snapshot, quantity, unit_price, line_total_cost, line_profit)
SELECT
  ii.invoice_id,
  ii.item_id,
  ii.variation_id,
  COALESCE(it.cost_price, 0) AS cost_snapshot,
  COALESCE(ii.quantity, 0),
  COALESCE(ii.unit_price, 0),
  COALESCE(it.cost_price, 0) * COALESCE(ii.quantity, 0),
  (COALESCE(ii.unit_price, 0) - COALESCE(it.cost_price, 0)) * COALESCE(ii.quantity, 0)
FROM public.invoice_items ii
JOIN public.items it ON it.id = ii.item_id
WHERE ii.item_id IS NOT NULL
ON CONFLICT (invoice_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO NOTHING;

-- Backfill invoice-level financial summaries for every paid / completed invoice.
INSERT INTO public.invoice_financials
  (invoice_id, total_sales, total_cost, total_profit, profit_margin, paid_at)
SELECT
  i.id,
  COALESCE(s.sales, 0),
  COALESCE(c.cost, 0),
  COALESCE(s.sales, 0) - COALESCE(c.cost, 0),
  CASE WHEN COALESCE(s.sales, 0) > 0
       THEN ((COALESCE(s.sales, 0) - COALESCE(c.cost, 0)) / s.sales) * 100
       ELSE 0 END,
  COALESCE(i.updated_at, now())
FROM public.invoices i
LEFT JOIN LATERAL (
  SELECT SUM(quantity * unit_price) AS sales
  FROM public.invoice_items WHERE invoice_id = i.id
) s ON true
LEFT JOIN LATERAL (
  SELECT SUM(line_total_cost) AS cost
  FROM public.invoice_item_financials WHERE invoice_id = i.id
) c ON true
WHERE i.status IN ('paid', 'completed')
ON CONFLICT (invoice_id) DO UPDATE SET
  total_sales = EXCLUDED.total_sales,
  total_cost = EXCLUDED.total_cost,
  total_profit = EXCLUDED.total_profit,
  profit_margin = EXCLUDED.profit_margin,
  updated_at = now();

-- Also relax the recompute trigger so that any status update that lands on paid/completed
-- refreshes the summary — not only strict status transitions. This future-proofs cases
-- where the frontend re-saves a paid invoice.
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
  SELECT COALESCE(SUM(line_total_cost), 0) INTO v_cost
    FROM public.invoice_item_financials WHERE invoice_id = NEW.id;
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
