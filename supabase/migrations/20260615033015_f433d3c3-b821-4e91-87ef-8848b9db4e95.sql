
CREATE OR REPLACE FUNCTION public.is_invoice_status_locked(_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _status IN ('confirmed','paid','unpaid','reserved','shipped','completed','cancelled')
$function$;
