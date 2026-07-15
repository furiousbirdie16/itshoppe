
CREATE OR REPLACE FUNCTION public.set_online_sale_cost(_online_sale_id uuid, _new_cost numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  s RECORD;
  v_qty numeric;
  v_paid numeric;
  v_is_paid boolean;
  v_unit numeric;
  v_line_cost numeric;
  v_line_profit numeric;
  v_margin numeric;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to set online sale cost';
  END IF;
  IF _new_cost IS NULL OR _new_cost < 0 THEN
    RAISE EXCEPTION 'Cost must be zero or positive';
  END IF;

  SELECT id, quantity, posted_price, amount_paid, payment_status, paid_at, item_id, variation_id
    INTO s FROM public.online_sales WHERE id = _online_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online sale not found';
  END IF;

  v_qty := COALESCE(s.quantity, 0);
  v_unit := COALESCE(s.posted_price, 0);
  v_paid := COALESCE(s.amount_paid, 0);
  v_is_paid := (s.payment_status = 'paid');
  v_line_cost := _new_cost * v_qty;
  IF v_is_paid THEN
    v_line_profit := v_paid - v_line_cost;
    IF v_paid > 0 THEN v_margin := (v_line_profit / v_paid) * 100; ELSE v_margin := NULL; END IF;
  ELSE
    v_line_profit := NULL;
    v_margin := NULL;
  END IF;

  INSERT INTO public.online_sale_financials
    (online_sale_id, item_id, variation_id, cost_snapshot, quantity, unit_price,
     amount_paid, line_total_cost, line_profit, gross_margin, is_paid, paid_at, has_cost)
  VALUES
    (s.id, s.item_id, s.variation_id, _new_cost, v_qty, v_unit,
     v_paid, v_line_cost, v_line_profit, v_margin, v_is_paid, s.paid_at, true)
  ON CONFLICT (online_sale_id) DO UPDATE SET
    cost_snapshot = EXCLUDED.cost_snapshot,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    amount_paid = EXCLUDED.amount_paid,
    line_total_cost = EXCLUDED.line_total_cost,
    line_profit = EXCLUDED.line_profit,
    gross_margin = EXCLUDED.gross_margin,
    is_paid = EXCLUDED.is_paid,
    paid_at = EXCLUDED.paid_at,
    has_cost = true,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_set_online_sale_cost(_ids uuid[], _new_cost numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  cnt integer := 0;
  x uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to set online sale cost';
  END IF;
  FOREACH x IN ARRAY _ids LOOP
    PERFORM public.set_online_sale_cost(x, _new_cost);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;
