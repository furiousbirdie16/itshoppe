-- A manual receivable names whoever owes it, typed, instead of picking from
-- the customer list: the person is often not a customer at all.
ALTER TABLE public.manual_receivables ADD COLUMN IF NOT EXISTS person_name text;

-- Keep the names of entries made before, so nothing goes blank.
UPDATE public.manual_receivables m
   SET person_name = c.name
  FROM public.customers c
 WHERE m.customer_id = c.id AND m.person_name IS NULL;
