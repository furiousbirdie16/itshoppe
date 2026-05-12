ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS inventory_deducted boolean NOT NULL DEFAULT false;

UPDATE public.invoices
   SET inventory_deducted = true
 WHERE status <> 'draft' AND inventory_deducted = false;