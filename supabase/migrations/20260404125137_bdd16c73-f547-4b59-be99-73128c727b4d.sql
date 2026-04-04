
CREATE TABLE public.overseas_suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  country TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'RMB')),
  exchange_rate NUMERIC NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.overseas_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage overseas suppliers"
ON public.overseas_suppliers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
