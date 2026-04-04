
CREATE TABLE public.overseas_purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.overseas_suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received')),
  order_date DATE DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  notes TEXT DEFAULT '',
  total_amount NUMERIC DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'RMB')),
  exchange_rate NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.overseas_purchase_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id UUID NOT NULL REFERENCES public.overseas_purchase_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.overseas_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overseas_purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage overseas POs"
ON public.overseas_purchase_orders
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can manage overseas PO items"
ON public.overseas_purchase_order_items
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Add sequence for overseas PO numbers
INSERT INTO public.document_sequences (id, prefix, next_number, padding)
VALUES ('overseas_po', 'OPO', 1, 5);
