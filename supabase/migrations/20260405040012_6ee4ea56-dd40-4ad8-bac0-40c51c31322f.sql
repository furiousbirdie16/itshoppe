
CREATE TYPE public.sales_channel AS ENUM ('shopee', 'lazada');

CREATE TABLE public.online_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_name TEXT NOT NULL,
  sales_channel public.sales_channel NOT NULL,
  posted_price NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.online_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage online sales"
ON public.online_sales
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

INSERT INTO public.document_sequences (id, prefix, next_number, padding)
VALUES 
  ('shopee_order', 'SHP-', 1, 6),
  ('lazada_order', 'LZD-', 1, 6)
ON CONFLICT (id) DO NOTHING;
