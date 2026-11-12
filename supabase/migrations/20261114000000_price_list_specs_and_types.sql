-- Price lists: specs as columns, and a type for each category.
--
-- `specs` holds what a camera is chosen by — MP, shape, indoor/outdoor, lens,
-- night vision, channels, extras — read from the sheet's own columns at
-- upload, so they can be shown and filtered instead of buried in the
-- description.
--
-- A category (a sheet such as "colorVu" or "Two-way Audio") can be given a
-- type ("Analog camera", "IP camera", "DVR", "NVR"…), set in bulk on the
-- Categories tab, so a filter can show only the analog cameras. Keyed by
-- brand and sheet name, like the price groups, so next month's upload keeps
-- it.
ALTER TABLE public.price_list_items
  ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.price_category_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (btrim(brand) <> ''),
  category TEXT NOT NULL CHECK (btrim(category) <> ''),
  type TEXT NOT NULL CHECK (btrim(type) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A category has one type at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_category_types_brand_category
  ON public.price_category_types (lower(btrim(brand)), lower(btrim(category)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_category_types TO authenticated;
GRANT ALL ON public.price_category_types TO service_role;
ALTER TABLE public.price_category_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view price_category_types" ON public.price_category_types;
CREATE POLICY "Authenticated can view price_category_types" ON public.price_category_types
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Admins can add price_category_types" ON public.price_category_types;
CREATE POLICY "Admins can add price_category_types" ON public.price_category_types
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can change price_category_types" ON public.price_category_types;
CREATE POLICY "Admins can change price_category_types" ON public.price_category_types
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can delete price_category_types" ON public.price_category_types;
CREATE POLICY "Admins can delete price_category_types" ON public.price_category_types
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

NOTIFY pgrst, 'reload schema';
