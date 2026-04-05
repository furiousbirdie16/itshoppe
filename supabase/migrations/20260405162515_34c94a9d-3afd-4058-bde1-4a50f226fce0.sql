-- Add item_id to online_sales for SKU tracking
ALTER TABLE public.online_sales
ADD COLUMN item_id uuid REFERENCES public.items(id) ON DELETE SET NULL;

-- Add item_id to overseas_purchase_order_items for SKU tracking
ALTER TABLE public.overseas_purchase_order_items
ADD COLUMN item_id uuid REFERENCES public.items(id) ON DELETE SET NULL;