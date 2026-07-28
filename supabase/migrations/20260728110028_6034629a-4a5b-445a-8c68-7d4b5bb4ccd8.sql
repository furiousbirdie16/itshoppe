-- 1. item_branch_stock table
CREATE TABLE public.item_branch_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_quantity integer NOT NULL DEFAULT 0,
  store_quantity integer NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 0,
  open_roll_remaining numeric NOT NULL DEFAULT 0,
  units_per_stock numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, branch_id)
);

CREATE INDEX idx_ibs_item ON public.item_branch_stock(item_id);
CREATE INDEX idx_ibs_branch ON public.item_branch_stock(branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_branch_stock TO authenticated;
GRANT ALL ON public.item_branch_stock TO service_role;

ALTER TABLE public.item_branch_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ibs_read" ON public.item_branch_stock
  FOR SELECT TO authenticated
  USING (public.user_has_branch(auth.uid(), branch_id));

CREATE POLICY "ibs_write" ON public.item_branch_stock
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_branch(auth.uid(), branch_id));

CREATE POLICY "ibs_update" ON public.item_branch_stock
  FOR UPDATE TO authenticated
  USING (public.user_has_branch(auth.uid(), branch_id))
  WITH CHECK (public.user_has_branch(auth.uid(), branch_id));

CREATE POLICY "ibs_delete" ON public.item_branch_stock
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Keep quantity = warehouse + store
CREATE OR REPLACE FUNCTION public.sync_ibs_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.quantity := COALESCE(NEW.warehouse_quantity,0) + COALESCE(NEW.store_quantity,0);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ibs_sync_total
BEFORE INSERT OR UPDATE ON public.item_branch_stock
FOR EACH ROW EXECUTE FUNCTION public.sync_ibs_total();

-- 2. Backfill Manila from items
INSERT INTO public.item_branch_stock
  (item_id, branch_id, warehouse_quantity, store_quantity, quantity, open_roll_remaining, units_per_stock)
SELECT
  i.id,
  (SELECT id FROM public.branches WHERE branch_code = 'MNL' LIMIT 1),
  COALESCE(i.warehouse_quantity, 0),
  COALESCE(i.store_quantity, 0),
  COALESCE(i.warehouse_quantity, 0) + COALESCE(i.store_quantity, 0),
  COALESCE(i.open_roll_remaining, 0),
  COALESCE(i.units_per_stock, 1)
FROM public.items i
ON CONFLICT (item_id, branch_id) DO NOTHING;

-- Gen San seed rows (0 stock) for every item so lookups don't miss
INSERT INTO public.item_branch_stock
  (item_id, branch_id, warehouse_quantity, store_quantity, quantity, open_roll_remaining, units_per_stock)
SELECT
  i.id,
  (SELECT id FROM public.branches WHERE branch_code = 'GES' LIMIT 1),
  0, 0, 0, 0,
  COALESCE(i.units_per_stock, 1)
FROM public.items i
WHERE EXISTS (SELECT 1 FROM public.branches WHERE branch_code = 'GES')
ON CONFLICT (item_id, branch_id) DO NOTHING;

-- 3. branch_id on inventory_movements
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

UPDATE public.inventory_movements
   SET branch_id = (SELECT id FROM public.branches WHERE branch_code = 'MNL' LIMIT 1)
 WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_mov_branch ON public.inventory_movements(branch_id);

-- 4. New movement types for inter-branch transfers
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'transfer_b2b_out';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'transfer_b2b_in';
