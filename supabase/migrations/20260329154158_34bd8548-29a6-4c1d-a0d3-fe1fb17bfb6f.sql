
CREATE TABLE public.document_sequences (
  id text PRIMARY KEY,
  prefix text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  padding integer NOT NULL DEFAULT 5
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on document_sequences" ON public.document_sequences FOR ALL USING (true) WITH CHECK (true);

-- Seed defaults
INSERT INTO public.document_sequences (id, prefix, next_number, padding) VALUES
  ('purchase_order', 'PO', 1, 5),
  ('quotation', 'QT', 1, 5),
  ('invoice', 'INV', 1, 5);
