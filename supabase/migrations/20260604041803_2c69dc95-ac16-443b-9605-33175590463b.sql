
CREATE POLICY "Auth view overseas po receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'overseas-po-receipts');
CREATE POLICY "Auth upload overseas po receipts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'overseas-po-receipts');
CREATE POLICY "Auth update overseas po receipts" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'overseas-po-receipts');
CREATE POLICY "Auth delete overseas po receipts" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'overseas-po-receipts');
