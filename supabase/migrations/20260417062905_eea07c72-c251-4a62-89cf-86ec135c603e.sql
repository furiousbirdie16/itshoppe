ALTER TABLE public.overseas_purchase_order_items
ADD COLUMN IF NOT EXISTS received_quantity integer NOT NULL DEFAULT 0;