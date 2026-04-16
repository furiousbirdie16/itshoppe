
ALTER TABLE public.quotation_items 
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN item_name text;

ALTER TABLE public.invoice_items 
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN item_name text;
