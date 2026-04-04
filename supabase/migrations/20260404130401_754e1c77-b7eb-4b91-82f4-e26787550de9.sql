
CREATE TABLE public.shipment_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id UUID REFERENCES public.overseas_purchase_orders(id) ON DELETE CASCADE,
  tracking_number TEXT DEFAULT '',
  shipping_method TEXT DEFAULT '',
  ship_date DATE,
  estimated_arrival DATE,
  actual_arrival DATE,
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'customs', 'delivered')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.shipment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage shipment tracking"
ON public.shipment_tracking
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
