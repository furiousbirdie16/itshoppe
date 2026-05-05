
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_reference_url text;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('payment-references', 'payment-references', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read payment references" ON storage.objects;
CREATE POLICY "Public read payment references" ON storage.objects FOR SELECT USING (bucket_id = 'payment-references');

DROP POLICY IF EXISTS "Authenticated upload payment references" ON storage.objects;
CREATE POLICY "Authenticated upload payment references" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payment-references');

DROP POLICY IF EXISTS "Authenticated update payment references" ON storage.objects;
CREATE POLICY "Authenticated update payment references" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'payment-references');

DROP POLICY IF EXISTS "Authenticated delete payment references" ON storage.objects;
CREATE POLICY "Authenticated delete payment references" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'payment-references');
