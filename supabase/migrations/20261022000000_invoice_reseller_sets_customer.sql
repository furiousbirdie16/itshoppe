-- An invoice sold through a reseller marks its customer as that reseller's.
--
-- Picking the reseller on the invoice is where staff actually learn it, and
-- asking them to go and edit the customer as well meant it was never done.
-- A direct sale (no reseller) leaves the customer's reseller alone: one
-- walk-in does not make them stop being the reseller's customer.

CREATE OR REPLACE FUNCTION public.invoice_reseller_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reseller_id IS NOT NULL
     AND NEW.customer_id IS NOT NULL
     AND NEW.customer_id <> NEW.reseller_id THEN
    UPDATE public.customers
       SET reseller_id = NEW.reseller_id
     WHERE id = NEW.customer_id
       AND reseller_id IS DISTINCT FROM NEW.reseller_id
       -- A reseller is the source, never the one sourced.
       AND classification <> 'reseller';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reseller_to_customer ON public.invoices;
CREATE TRIGGER trg_invoice_reseller_to_customer
  AFTER INSERT OR UPDATE OF reseller_id, customer_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_reseller_to_customer();

-- Invoices already saved with a reseller: give their customers it now.
UPDATE public.customers c
   SET reseller_id = latest.reseller_id
  FROM (
    SELECT DISTINCT ON (customer_id) customer_id, reseller_id
      FROM public.invoices
     WHERE reseller_id IS NOT NULL AND customer_id IS NOT NULL
     ORDER BY customer_id, created_at DESC
  ) latest
 WHERE c.id = latest.customer_id
   AND c.id <> latest.reseller_id
   AND c.classification <> 'reseller'
   AND c.reseller_id IS DISTINCT FROM latest.reseller_id;
