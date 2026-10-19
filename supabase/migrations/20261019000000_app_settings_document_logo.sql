-- Settings that belong to the business rather than to one user, starting
-- with the logo printed on invoices, quotations and purchase orders.
--
-- Everyone signed in reads them (anyone can print an invoice); only an admin
-- changes them. The logo is kept as a small data URL in `value`, downscaled
-- in the browser before upload, so printing never waits on a storage fetch.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users read app settings" ON public.app_settings;
CREATE POLICY "Signed-in users read app settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins write app settings" ON public.app_settings;
CREATE POLICY "Admins write app settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
