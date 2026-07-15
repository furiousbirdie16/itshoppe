
CREATE OR REPLACE FUNCTION public.set_invoice_item_cost(_financial_id uuid, _new_cost numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid;
  f RECORD;
  v_sales numeric := 0;
  v_cost numeric := 0;
  v_profit numeric := 0;
  v_margin numeric := 0;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to override invoice item cost';
  END IF;
  IF _new_cost IS NULL OR _new_cost < 0 THEN
    RAISE EXCEPTION 'Cost must be zero or positive';
  END IF;

  SELECT * INTO f FROM public.invoice_item_financials WHERE id = _financial_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice line financial not found'; END IF;

  UPDATE public.invoice_item_financials
     SET cost_snapshot = _new_cost,
         line_total_cost = _new_cost * COALESCE(quantity, 0),
         line_profit = (COALESCE(unit_price, 0) - _new_cost) * COALESCE(quantity, 0),
         updated_at = now()
   WHERE id = _financial_id;

  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_sales
    FROM public.invoice_items WHERE invoice_id = f.invoice_id;
  SELECT COALESCE(SUM(line_total_cost), 0) INTO v_cost
    FROM public.invoice_item_financials
    WHERE invoice_id = f.invoice_id AND line_total_cost IS NOT NULL;
  v_profit := v_sales - v_cost;
  IF v_sales > 0 THEN v_margin := (v_profit / v_sales) * 100; END IF;

  INSERT INTO public.invoice_financials
    (invoice_id, total_sales, total_cost, total_profit, profit_margin)
  VALUES
    (f.invoice_id, v_sales, v_cost, v_profit, v_margin)
  ON CONFLICT (invoice_id) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_cost = EXCLUDED.total_cost,
    total_profit = EXCLUDED.total_profit,
    profit_margin = EXCLUDED.profit_margin,
    updated_at = now();
END;
$$;
