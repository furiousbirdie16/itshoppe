
ALTER TABLE public.purchase_order_items
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS item_name text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_terms integer,
  ADD COLUMN IF NOT EXISTS payment_due_date date;
