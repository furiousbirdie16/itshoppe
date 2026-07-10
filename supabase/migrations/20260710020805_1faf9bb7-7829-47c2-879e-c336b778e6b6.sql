
-- Independent cost per variation. NULL = not set (do NOT inherit parent cost).
ALTER TABLE public.item_variations ADD COLUMN IF NOT EXISTS cost_price NUMERIC;

-- Allow NULL cost snapshots on invoice lines so we can distinguish "unknown" from zero.
ALTER TABLE public.invoice_item_financials ALTER COLUMN cost_snapshot DROP NOT NULL;
ALTER TABLE public.invoice_item_financials ALTER COLUMN line_total_cost DROP NOT NULL;
ALTER TABLE public.invoice_item_financials ALTER COLUMN line_profit DROP NOT NULL;

-- Snapshot cost from the SPECIFIC variation sold. Never inherit parent cost.
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cost NUMERIC;               -- NULL means "cost not set"
  v_line_cost NUMERIC;
  v_line_profit NUMERIC;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.variation_id IS NOT NULL THEN
    -- Variation sale: use ONLY the variation's own cost. Do not fall back to parent.
    SELECT cost_price INTO v_cost FROM public.item_variations WHERE id = NEW.variation_id;
  ELSE
    -- Plain item sale (no variation): use item cost.
    SELECT cost_price INTO v_cost FROM public.items WHERE id = NEW.item_id;
  END IF;

  IF v_cost IS NULL THEN
    v_line_cost := NULL;
    v_line_profit := NULL;
  ELSE
    v_line_cost := v_cost * COALESCE(NEW.quantity, 0);
    v_line_profit := (COALESCE(NEW.unit_price, 0) - v_cost) * COALESCE(NEW.quantity, 0);
  END IF;

  INSERT INTO public.invoice_item_financials
    (invoice_id, item_id, variation_id, cost_snapshot, quantity, unit_price, line_total_cost, line_profit)
  VALUES
    (NEW.invoice_id, NEW.item_id, NEW.variation_id, v_cost,
     COALESCE(NEW.quantity, 0), COALESCE(NEW.unit_price, 0),
     v_line_cost, v_line_profit)
  ON CONFLICT (invoice_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    line_total_cost = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                           ELSE invoice_item_financials.cost_snapshot * EXCLUDED.quantity END,
    line_profit = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                       ELSE (EXCLUDED.unit_price - invoice_item_financials.cost_snapshot) * EXCLUDED.quantity END,
    updated_at = now();

  RETURN NEW;
END;
$function$;

-- Roll-up: skip NULL-cost lines in totals. Sales still include full revenue.
CREATE OR REPLACE FUNCTION public.recompute_invoice_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    FROM public.invoice_item_financials
    WHERE invoice_id = NEW.id AND line_total_cost IS NOT NULL;
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
$function$;
