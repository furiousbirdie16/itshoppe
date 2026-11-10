-- Price lists with several named prices per model (TP-Link: VIP, Dealer,
-- Bottom, SRP) alongside the one-price SDP lists (Hikvision).
--
-- A list says which named prices it carries; an empty list of names means a
-- one-price SDP list, priced through the markup groups as before. For a
-- multi-price list, `sdp` holds the VIP price as its base and `prices` holds
-- all four. Warranty and the supplier's EOL / price-increase marks come along.
ALTER TABLE public.price_lists
  ADD COLUMN IF NOT EXISTS price_columns TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.price_list_items
  ADD COLUMN IF NOT EXISTS prices JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
