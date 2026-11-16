-- Office price list: products marked "No stock", and links to inventory.
--
-- Your own price list (junction boxes, cables, power supplies) names
-- products you also keep in Inventory, under different names. Each price
-- list product can be linked to its inventory item, so quoting it adds the
-- real item (stock is then deducted when it is invoiced) at the price list's
-- price. Links are kept by brand and product name, so next month's upload
-- keeps them.
--
-- A product marked "NO STOCK" in place of its prices is kept with no price.

ALTER TABLE public.price_list_items ALTER COLUMN sdp DROP NOT NULL;
ALTER TABLE public.price_list_items DROP CONSTRAINT IF EXISTS price_list_items_sdp_check;
ALTER TABLE public.price_list_items
  ADD CONSTRAINT price_list_items_sdp_check CHECK (sdp IS NULL OR sdp > 0);

CREATE TABLE IF NOT EXISTS public.price_item_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (btrim(brand) <> ''),
  product TEXT NOT NULL CHECK (btrim(product) <> ''),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A price list product links to one inventory item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_item_links_brand_product
  ON public.price_item_links (lower(btrim(brand)), lower(btrim(product)));
CREATE INDEX IF NOT EXISTS idx_price_item_links_item ON public.price_item_links (item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_item_links TO authenticated;
GRANT ALL ON public.price_item_links TO service_role;
ALTER TABLE public.price_item_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view price_item_links" ON public.price_item_links;
CREATE POLICY "Authenticated can view price_item_links" ON public.price_item_links
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Admins can add price_item_links" ON public.price_item_links;
CREATE POLICY "Admins can add price_item_links" ON public.price_item_links
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can change price_item_links" ON public.price_item_links;
CREATE POLICY "Admins can change price_item_links" ON public.price_item_links
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can delete price_item_links" ON public.price_item_links;
CREATE POLICY "Admins can delete price_item_links" ON public.price_item_links
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

NOTIFY pgrst, 'reload schema';
