
ALTER TABLE public.asset_snapshots
  ADD COLUMN IF NOT EXISTS payable_assets_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incoming_assets_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accounts_payable_value NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.generate_asset_snapshot()
 RETURNS public.asset_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
  v_inv numeric := 0;
  v_incoming_local numeric := 0;
  v_incoming_overseas numeric := 0;
  v_payable numeric := 0;
  v_ap numeric := 0;
  v_recv numeric := 0;
  v_total numeric := 0;
  v_row public.asset_snapshots;
BEGIN
  v_date := (now() AT TIME ZONE 'Asia/Manila')::date;

  -- 1) On-hand inventory at current cost
  SELECT COALESCE(SUM(quantity * cost_price), 0) INTO v_inv FROM public.items;

  -- 2) Local PO remaining (treated as Incoming Assets)
  SELECT COALESCE(SUM(
    GREATEST((li.quantity - li.received_quantity), 0) * COALESCE(li.unit_cost, 0)
  ), 0) INTO v_incoming_local
  FROM public.purchase_order_items li
  JOIN public.purchase_orders po ON po.id = li.po_id
  WHERE po.status::text <> 'received';

  -- 3) Overseas PO remaining, classified by status:
  --    - shipped, not paid  -> Payable Assets + Accounts Payable
  --    - paid, shipped      -> Incoming Assets
  --    - partially_received -> Incoming Assets (assumed paid)
  --    - other (draft/unpaid/paid_not_shipped/received/cargo_adjusted/pending_cargo_adjustment) -> 0
  SELECT
    COALESCE(SUM(CASE
      WHEN po.status IN ('shipped_not_paid','sent') THEN
        GREATEST((li.quantity - li.received_quantity), 0)
          * COALESCE(li.unit_cost, 0)
          * COALESCE(po.exchange_rate, 1)
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN po.status IN ('shipped','partially_received') THEN
        GREATEST((li.quantity - li.received_quantity), 0)
          * COALESCE(li.unit_cost, 0)
          * COALESCE(po.exchange_rate, 1)
      ELSE 0 END), 0)
  INTO v_payable, v_incoming_overseas
  FROM public.overseas_purchase_order_items li
  JOIN public.overseas_purchase_orders po ON po.id = li.po_id
  WHERE po.status NOT IN ('received','cargo_adjusted','pending_cargo_adjustment');

  -- Accounts Payable mirrors Payable Assets (what we owe the supplier for shipped goods)
  v_ap := v_payable;

  -- 4) Receivables (customer side)
  SELECT COALESCE(SUM(total_amount), 0) INTO v_recv
  FROM public.invoices WHERE status::text IN ('confirmed','unpaid','shipped');

  v_recv := v_recv + COALESCE((
    SELECT SUM(amount) FROM public.manual_receivables WHERE status <> 'paid'
  ), 0);

  -- 5) Total assets = Inventory + Incoming + Payable (avoids double-counting since each
  --    overseas line falls into exactly one bucket and 'received' lines are already in inventory).
  v_total := v_inv + v_incoming_local + v_incoming_overseas + v_payable;

  INSERT INTO public.asset_snapshots
    (snapshot_date, inventory_value, incoming_stock_value, payable_assets_value,
     incoming_assets_value, accounts_payable_value, receivables_value, total_asset_value, captured_at)
  VALUES (v_date, v_inv, v_incoming_local + v_incoming_overseas, v_payable,
          v_incoming_local + v_incoming_overseas, v_ap, v_recv, v_total, now())
  ON CONFLICT (snapshot_date) DO UPDATE
    SET inventory_value = EXCLUDED.inventory_value,
        incoming_stock_value = EXCLUDED.incoming_stock_value,
        payable_assets_value = EXCLUDED.payable_assets_value,
        incoming_assets_value = EXCLUDED.incoming_assets_value,
        accounts_payable_value = EXCLUDED.accounts_payable_value,
        receivables_value = EXCLUDED.receivables_value,
        total_asset_value = EXCLUDED.total_asset_value,
        captured_at = EXCLUDED.captured_at
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
