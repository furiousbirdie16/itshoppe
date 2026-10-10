-- Seed for a brand-new, empty ITSHOPPE instance.
--
-- Run this against a fresh Supabase project AFTER the schema has been restored
-- into it. It creates only what the app cannot start without: the document
-- numbering, one branch, and the two storage buckets. No business data.
--
-- Safe to run twice; every statement is conditional.

-- ---------------------------------------------------------------------------
-- 1. Document numbering.
--
-- Every number is built as "<prefix>-<next_number padded>", so a prefix of
-- 'INV' gives INV-00001. Do not put a trailing dash in the prefix or the
-- numbers come out as INV--00001.
-- ---------------------------------------------------------------------------
INSERT INTO public.document_sequences (id, prefix, next_number, padding) VALUES
  ('invoice',                  'INV', 1, 5),
  ('quotation',                'QT',  1, 5),
  ('purchase_order',           'PO',  1, 5),
  ('overseas_purchase_order',  'OPO', 1, 5),
  ('shopee_order',             'SHP', 1, 6),
  ('lazada_order',             'LZD', 1, 6),
  ('STOCK_TRANSFER',           'TRF', 1, 4)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. One branch.
--
-- Stock is kept per branch and several screens refuse to act without one, so
-- an instance with no branch cannot record anything. Rename it to suit.
-- ---------------------------------------------------------------------------
INSERT INTO public.branches (branch_name, branch_code, is_active)
SELECT 'Main', 'MAIN', true
WHERE NOT EXISTS (SELECT 1 FROM public.branches);

-- ---------------------------------------------------------------------------
-- 3. Storage buckets, both private.
--
-- Supplier receipts and payment screenshots are read through signed URLs, so
-- neither bucket should ever be public.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('overseas-po-receipts', 'overseas-po-receipts', false),
       ('payment-references',   'payment-references',   false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. After the first person signs up, make them an admin.
--
-- Everyone is created as 'user' by the signup trigger, and a shop with no
-- admin cannot reach Users, Settings or any money page. Run this on its own
-- once that first account exists, with their email in place of the one below.
-- ---------------------------------------------------------------------------
-- UPDATE public.user_roles
-- SET role = 'admin'
-- WHERE user_id = (SELECT id FROM auth.users WHERE email = 'friend@example.com');
