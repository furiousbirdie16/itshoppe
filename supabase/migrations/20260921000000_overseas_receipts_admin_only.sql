-- Supplier receipts are admin-only.
--
-- The bucket's policies were written as "any signed-in user", so every staff
-- account could read — and delete — the receipts that show what we actually
-- paid our overseas suppliers. Hiding the panel in the app is not enough: the
-- browser holds a real Supabase token, so anyone could ask storage directly.
-- The database is the place this has to be enforced.

DROP POLICY IF EXISTS "Auth view overseas po receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload overseas po receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth update overseas po receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete overseas po receipts" ON storage.objects;

CREATE POLICY "Admins view overseas po receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'overseas-po-receipts' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload overseas po receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'overseas-po-receipts' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update overseas po receipts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'overseas-po-receipts' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'overseas-po-receipts' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete overseas po receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'overseas-po-receipts' AND public.has_role(auth.uid(), 'admin'));

-- A public bucket serves files with no policy check at all, so make sure this
-- one is private regardless of how it was created.
UPDATE storage.buckets SET public = false WHERE id = 'overseas-po-receipts';
