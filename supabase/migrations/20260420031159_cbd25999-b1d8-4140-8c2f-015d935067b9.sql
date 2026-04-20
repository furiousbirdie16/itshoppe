ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS received_date date;

ALTER TABLE public.overseas_purchase_order_items
  ADD COLUMN IF NOT EXISTS received_date date;