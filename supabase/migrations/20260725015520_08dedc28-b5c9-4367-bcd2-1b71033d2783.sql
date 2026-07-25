ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS variation_id uuid REFERENCES public.item_variations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS dest_location text,
  ADD COLUMN IF NOT EXISTS balance_before numeric,
  ADD COLUMN IF NOT EXISTS balance_after numeric,
  ADD COLUMN IF NOT EXISTS open_before numeric,
  ADD COLUMN IF NOT EXISTS open_after numeric,
  ADD COLUMN IF NOT EXISTS dest_balance_before numeric,
  ADD COLUMN IF NOT EXISTS dest_balance_after numeric,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS user_email text;

ALTER TABLE public.inventory_movements
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

CREATE INDEX IF NOT EXISTS idx_movements_variation ON public.inventory_movements(variation_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON public.inventory_movements(created_at DESC);