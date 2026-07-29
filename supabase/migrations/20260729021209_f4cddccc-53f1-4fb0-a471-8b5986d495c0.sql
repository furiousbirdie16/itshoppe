
-- Add branch_id to transactional tables, backfill to Manila, enforce NOT NULL
DO $$
DECLARE
  mnl uuid;
BEGIN
  SELECT id INTO mnl FROM public.branches WHERE branch_code = 'MNL';

  -- purchase_orders
  ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
  UPDATE public.purchase_orders SET branch_id = mnl WHERE branch_id IS NULL;
  ALTER TABLE public.purchase_orders ALTER COLUMN branch_id SET NOT NULL;
  EXECUTE format('ALTER TABLE public.purchase_orders ALTER COLUMN branch_id SET DEFAULT %L::uuid', mnl);

  -- overseas_purchase_orders
  ALTER TABLE public.overseas_purchase_orders ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
  UPDATE public.overseas_purchase_orders SET branch_id = mnl WHERE branch_id IS NULL;
  ALTER TABLE public.overseas_purchase_orders ALTER COLUMN branch_id SET NOT NULL;
  EXECUTE format('ALTER TABLE public.overseas_purchase_orders ALTER COLUMN branch_id SET DEFAULT %L::uuid', mnl);

  -- invoices
  ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
  UPDATE public.invoices SET branch_id = mnl WHERE branch_id IS NULL;
  ALTER TABLE public.invoices ALTER COLUMN branch_id SET NOT NULL;
  EXECUTE format('ALTER TABLE public.invoices ALTER COLUMN branch_id SET DEFAULT %L::uuid', mnl);

  -- quotations
  ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
  UPDATE public.quotations SET branch_id = mnl WHERE branch_id IS NULL;
  ALTER TABLE public.quotations ALTER COLUMN branch_id SET NOT NULL;
  EXECUTE format('ALTER TABLE public.quotations ALTER COLUMN branch_id SET DEFAULT %L::uuid', mnl);

  -- online_sales
  ALTER TABLE public.online_sales ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
  UPDATE public.online_sales SET branch_id = mnl WHERE branch_id IS NULL;
  ALTER TABLE public.online_sales ALTER COLUMN branch_id SET NOT NULL;
  EXECUTE format('ALTER TABLE public.online_sales ALTER COLUMN branch_id SET DEFAULT %L::uuid', mnl);
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_branch ON public.purchase_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_overseas_purchase_orders_branch ON public.overseas_purchase_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_branch ON public.invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_quotations_branch ON public.quotations(branch_id);
CREATE INDEX IF NOT EXISTS idx_online_sales_branch ON public.online_sales(branch_id);

-- Helper: apply a branch-scoped stock delta atomically. Ensures the
-- item_branch_stock row exists, applies math on warehouse/store/open-roll,
-- and returns the resulting balances so the app can log ledger entries.
CREATE OR REPLACE FUNCTION public.apply_branch_stock_change(
  _item_id uuid,
  _branch_id uuid,
  _location text,           -- 'warehouse' | 'store'
  _delta_stock numeric,     -- change to warehouse_qty OR store_qty (stock units)
  _delta_open  numeric,     -- change to open_roll_remaining (base units)
  _units_per_stock numeric  -- NULL to keep existing
) RETURNS TABLE (
  warehouse_quantity integer,
  store_quantity integer,
  quantity integer,
  open_roll_remaining numeric,
  units_per_stock numeric,
  wh_before integer,
  st_before integer,
  open_before numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.item_branch_stock%ROWTYPE;
  new_wh integer;
  new_st integer;
  new_open numeric;
  new_ups numeric;
BEGIN
  IF _item_id IS NULL OR _branch_id IS NULL THEN
    RAISE EXCEPTION 'item_id and branch_id are required';
  END IF;

  -- Ensure row exists
  INSERT INTO public.item_branch_stock (item_id, branch_id, warehouse_quantity, store_quantity, quantity, open_roll_remaining, units_per_stock)
  VALUES (_item_id, _branch_id, 0, 0, 0, 0, COALESCE(_units_per_stock, 1))
  ON CONFLICT (item_id, branch_id) DO NOTHING;

  SELECT * INTO r FROM public.item_branch_stock
   WHERE item_id = _item_id AND branch_id = _branch_id FOR UPDATE;

  wh_before := r.warehouse_quantity;
  st_before := r.store_quantity;
  open_before := r.open_roll_remaining;

  new_wh := r.warehouse_quantity;
  new_st := r.store_quantity;
  IF _location = 'warehouse' THEN
    new_wh := GREATEST(0, r.warehouse_quantity + COALESCE(_delta_stock,0)::integer);
  ELSIF _location = 'store' THEN
    new_st := r.store_quantity + COALESCE(_delta_stock,0)::integer;
  END IF;

  new_open := COALESCE(r.open_roll_remaining,0) + COALESCE(_delta_open,0);
  IF new_open < 0 THEN new_open := 0; END IF;

  new_ups := COALESCE(_units_per_stock, r.units_per_stock, 1);

  UPDATE public.item_branch_stock
     SET warehouse_quantity = new_wh,
         store_quantity = new_st,
         quantity = new_wh + new_st,
         open_roll_remaining = new_open,
         units_per_stock = new_ups,
         updated_at = now()
   WHERE item_id = _item_id AND branch_id = _branch_id;

  warehouse_quantity := new_wh;
  store_quantity := new_st;
  quantity := new_wh + new_st;
  open_roll_remaining := new_open;
  units_per_stock := new_ups;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_branch_stock_change(uuid, uuid, text, numeric, numeric, numeric) TO authenticated, service_role;
