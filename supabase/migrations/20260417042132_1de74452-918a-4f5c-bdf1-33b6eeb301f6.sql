-- Manual receivables: standalone pending payments not tied to invoices
CREATE TABLE public.manual_receivables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view manual receivables"
  ON public.manual_receivables FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert manual receivables"
  ON public.manual_receivables FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update manual receivables"
  ON public.manual_receivables FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admins can delete manual receivables"
  ON public.manual_receivables FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_manual_receivables_updated_at
  BEFORE UPDATE ON public.manual_receivables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();