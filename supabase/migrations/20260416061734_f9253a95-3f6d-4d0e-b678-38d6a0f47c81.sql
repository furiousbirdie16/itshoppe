ALTER TABLE public.quotations ADD COLUMN payment_terms integer DEFAULT NULL;
ALTER TABLE public.quotations ADD COLUMN payment_due_date date DEFAULT NULL;