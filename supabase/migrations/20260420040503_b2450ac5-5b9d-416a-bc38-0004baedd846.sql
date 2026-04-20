-- Extend items with base unit and open roll tracking
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS units_per_stock numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS open_roll_remaining numeric NOT NULL DEFAULT 0;

-- Variation type enum
DO $$ BEGIN
  CREATE TYPE public.variation_type AS ENUM ('pack', 'cut');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Item variations table
CREATE TABLE IF NOT EXISTS public.item_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  type public.variation_type NOT NULL,
  factor numeric NOT NULL DEFAULT 1,
  selling_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_variations_item_id ON public.item_variations(item_id);

ALTER TABLE public.item_variations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view item variations" ON public.item_variations;
CREATE POLICY "Authenticated can view item variations"
  ON public.item_variations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can manage item variations" ON public.item_variations;
CREATE POLICY "Authenticated can manage item variations"
  ON public.item_variations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_item_variations_updated_at ON public.item_variations;
CREATE TRIGGER update_item_variations_updated_at
  BEFORE UPDATE ON public.item_variations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reference variation on sold line items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS variation_id uuid REFERENCES public.item_variations(id) ON DELETE SET NULL;

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS variation_id uuid REFERENCES public.item_variations(id) ON DELETE SET NULL;

ALTER TABLE public.online_sales
  ADD COLUMN IF NOT EXISTS variation_id uuid REFERENCES public.item_variations(id) ON DELETE SET NULL;