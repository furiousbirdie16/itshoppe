
-- 1) Replace "Allow all" public policies with authenticated-only policies
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'customers','suppliers','sales_agents','items',
    'invoices','invoice_items','quotations','quotation_items',
    'purchase_orders','purchase_order_items','inventory_movements',
    'document_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all on '||t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'Authenticated full access on '||t, t
    );
  END LOOP;
END$$;

-- 2) Set fixed search_path on the two functions missing it
ALTER FUNCTION public.is_invoice_status_locked(text) SET search_path = public;
ALTER FUNCTION public.is_quotation_status_locked(text) SET search_path = public;

-- 3) Revoke EXECUTE from anon and public on SECURITY DEFINER functions
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.nspname, r.proname, r.args);
  END LOOP;
END$$;
