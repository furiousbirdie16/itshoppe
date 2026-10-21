-- Allow 'reseller' as a customer classification.
--
-- The classification is checked by a trigger rather than a CHECK constraint,
-- and the list it checks against still had only the original three types, so
-- marking a customer Reseller was refused with "Invalid customer
-- classification: reseller".

CREATE OR REPLACE FUNCTION public.validate_customer_classification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.classification NOT IN ('retail','wholesale','recurring','reseller') THEN
    RAISE EXCEPTION 'Invalid customer classification: %', NEW.classification;
  END IF;
  RETURN NEW;
END;
$$;
