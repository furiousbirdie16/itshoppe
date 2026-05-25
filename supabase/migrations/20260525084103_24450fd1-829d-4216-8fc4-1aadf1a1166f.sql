
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE public.asset_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  inventory_value numeric NOT NULL DEFAULT 0,
  incoming_stock_value numeric NOT NULL DEFAULT 0,
  receivables_value numeric NOT NULL DEFAULT 0,
  total_asset_value numeric NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_snapshots_date ON public.asset_snapshots(snapshot_date DESC);

ALTER TABLE public.asset_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view asset snapshots"
  ON public.asset_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage asset snapshots"
  ON public.asset_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.generate_asset_snapshot()
RETURNS public.asset_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_date date;
  v_inv numeric := 0;
  v_incoming numeric := 0;
  v_recv numeric := 0;
  v_total numeric := 0;
  v_row public.asset_snapshots;
BEGIN
  v_date := (now() AT TIME ZONE 'Asia/Manila')::date;

  SELECT COALESCE(SUM(quantity * cost_price), 0) INTO v_inv FROM public.items;

  SELECT COALESCE(SUM(
    GREATEST((li.quantity - li.received_quantity), 0) * COALESCE(li.unit_cost, 0)
  ), 0) INTO v_incoming
  FROM public.purchase_order_items li
  JOIN public.purchase_orders po ON po.id = li.po_id
  WHERE po.status::text <> 'received';

  v_incoming := v_incoming + COALESCE((
    SELECT SUM(
      GREATEST((li.quantity - li.received_quantity), 0)
      * COALESCE(li.unit_cost, 0)
      * COALESCE(po.exchange_rate, 1)
    )
    FROM public.overseas_purchase_order_items li
    JOIN public.overseas_purchase_orders po ON po.id = li.po_id
    WHERE po.status <> 'received'
  ), 0);

  SELECT COALESCE(SUM(total_amount), 0) INTO v_recv
  FROM public.invoices WHERE status::text IN ('confirmed', 'unpaid');

  v_recv := v_recv + COALESCE((
    SELECT SUM(amount) FROM public.manual_receivables WHERE status <> 'paid'
  ), 0);

  v_total := v_inv + v_incoming + v_recv;

  INSERT INTO public.asset_snapshots
    (snapshot_date, inventory_value, incoming_stock_value, receivables_value, total_asset_value, captured_at)
  VALUES (v_date, v_inv, v_incoming, v_recv, v_total, now())
  ON CONFLICT (snapshot_date) DO UPDATE
    SET inventory_value = EXCLUDED.inventory_value,
        incoming_stock_value = EXCLUDED.incoming_stock_value,
        receivables_value = EXCLUDED.receivables_value,
        total_asset_value = EXCLUDED.total_asset_value,
        captured_at = EXCLUDED.captured_at
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_asset_snapshot() TO authenticated;

-- Daily at 23:59 Asia/Manila = 15:59 UTC
SELECT cron.schedule(
  'daily-asset-snapshot',
  '59 15 * * *',
  $cron$ SELECT public.generate_asset_snapshot(); $cron$
);
