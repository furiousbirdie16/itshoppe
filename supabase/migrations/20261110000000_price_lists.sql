-- Supplier price lists, kept apart from inventory.
--
-- A supplier's Excel price list (Hikvision: 80-odd sheets, about 2,500
-- models) is stored as its own list of rows. Nothing here has stock, cost
-- history or serials, so Inventory, stock levels and reports never see it.
-- A model becomes an inventory item only when someone adds it on purpose.
--
-- Selling prices are not stored per model. Each brand has a few price groups
-- (CCTV cameras: SDP + 250, Networking: SDP + 15%), each sheet of the price
-- list belongs to one group, and the price is worked out when it is shown.
-- Changing a markup reprices every model in the group at once.

-- ---------------------------------------------------------------------------
-- One upload of a supplier's file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (btrim(brand) <> ''),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  file_name TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  -- Archived lists stay for comparing prices but are not offered on quotes.
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The models in it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK (btrim(model) <> ''),
  -- "DS-2CD2047G2-L (C)" is found by typing "2047g2-l(c)" or "2047G2L C".
  model_key TEXT GENERATED ALWAYS AS (lower(regexp_replace(model, '[^a-zA-Z0-9]', '', 'g'))) STORED,
  description TEXT NOT NULL DEFAULT '',
  -- The sheet the model came from ("colorVu", "NVR", "PTZ DE").
  category TEXT NOT NULL DEFAULT '',
  sdp NUMERIC(14, 2) NOT NULL CHECK (sdp > 0),
  msrp NUMERIC(14, 2) CHECK (msrp IS NULL OR msrp > 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_list
  ON public.price_list_items (price_list_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_price_list_items_list_category
  ON public.price_list_items (price_list_id, category);

-- ---------------------------------------------------------------------------
-- Price groups and which sheets belong to them, per brand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (btrim(brand) <> ''),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  markup_type TEXT NOT NULL DEFAULT 'amount' CHECK (markup_type IN ('amount', 'percent')),
  markup_value NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (markup_value >= 0),
  -- The "Everything else" group: prices any sheet nobody has sorted yet.
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_groups_brand_name
  ON public.price_groups (lower(btrim(brand)), lower(btrim(name)));
-- One fallback group per brand.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_groups_brand_default
  ON public.price_groups (lower(btrim(brand))) WHERE is_default;

-- Keyed by sheet name, not by upload, so next month's list prices itself.
CREATE TABLE IF NOT EXISTS public.price_group_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (btrim(brand) <> ''),
  category TEXT NOT NULL CHECK (btrim(category) <> ''),
  group_id UUID NOT NULL REFERENCES public.price_groups(id) ON DELETE CASCADE
);

-- A sheet is in one group at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_group_categories_brand_category
  ON public.price_group_categories (lower(btrim(brand)), lower(btrim(category)));

-- ---------------------------------------------------------------------------
-- Access: everyone looks prices up and quotes from them; admins upload lists
-- and set markups.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_lists', 'price_list_items', 'price_groups', 'price_group_categories'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can view %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Authenticated can view %s" ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "Admins can add %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admins can add %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''::app_role))', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "Admins can change %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admins can change %s" ON public.%I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin''::app_role)) WITH CHECK (public.has_role(auth.uid(), ''admin''::app_role))', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admins can delete %s" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''::app_role))', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
