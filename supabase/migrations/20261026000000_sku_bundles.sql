-- Bundle SKUs: a marketplace SKU that stands for one or more inventory items.
--
-- Shopee listings are often a kit ("CAT6 Pure Copper Indoor 100m w/ crimp" is
-- a 100m cut of cable and two passthrough connectors) or simply named
-- differently from the inventory SKU. Defined once here, an upload turns such
-- a line into its parts: the line marked gets_price carries the whole price,
-- the rest go in at ₱0, and each part's stock is deducted.

CREATE TABLE IF NOT EXISTS public.sku_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT
);

-- Matched ignoring case and surrounding spaces, as uploads match SKUs.
CREATE UNIQUE INDEX IF NOT EXISTS sku_bundles_sku_key ON public.sku_bundles (lower(btrim(sku)));

CREATE TABLE IF NOT EXISTS public.sku_bundle_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES public.sku_bundles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  variation_id UUID REFERENCES public.item_variations(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  gets_price BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sku_bundle_lines_bundle ON public.sku_bundle_lines (bundle_id);

ALTER TABLE public.sku_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_bundle_lines ENABLE ROW LEVEL SECURITY;

-- Staff upload orders too, and are the ones who meet an unknown SKU first.
DROP POLICY IF EXISTS "Signed-in users manage SKU bundles" ON public.sku_bundles;
CREATE POLICY "Signed-in users manage SKU bundles"
  ON public.sku_bundles FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Signed-in users manage SKU bundle lines" ON public.sku_bundle_lines;
CREATE POLICY "Signed-in users manage SKU bundle lines"
  ON public.sku_bundle_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
