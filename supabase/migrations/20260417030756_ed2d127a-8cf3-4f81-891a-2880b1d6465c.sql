
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sales_agent text DEFAULT '';
