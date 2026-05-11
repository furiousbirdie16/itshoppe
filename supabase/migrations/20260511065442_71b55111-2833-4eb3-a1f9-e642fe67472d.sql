
-- Fixed/preferred prices per customer + item (+ optional variation)
CREATE TABLE public.customer_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  item_id UUID NOT NULL,
  variation_id UUID,
  fixed_price NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique per customer/item/variation (treat NULL variation as a distinct slot)
CREATE UNIQUE INDEX customer_prices_uniq
  ON public.customer_prices (customer_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX customer_prices_customer_idx ON public.customer_prices (customer_id);
CREATE INDEX customer_prices_item_idx ON public.customer_prices (item_id);

ALTER TABLE public.customer_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view customer prices"
  ON public.customer_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert customer prices"
  ON public.customer_prices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update customer prices"
  ON public.customer_prices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete customer prices"
  ON public.customer_prices FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER customer_prices_updated_at
  BEFORE UPDATE ON public.customer_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Append-only price history per customer
CREATE TABLE public.customer_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  item_id UUID NOT NULL,
  variation_id UUID,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  reference_id UUID,
  reference_number TEXT,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cph_customer_item_idx ON public.customer_price_history (customer_id, item_id, sold_at DESC);
CREATE INDEX cph_item_idx ON public.customer_price_history (item_id);
CREATE INDEX cph_reference_idx ON public.customer_price_history (reference_id);

ALTER TABLE public.customer_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view price history"
  ON public.customer_price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert price history"
  ON public.customer_price_history FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger: log invoice item prices
CREATE OR REPLACE FUNCTION public.log_invoice_price_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer UUID;
  v_number TEXT;
  v_email TEXT;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  SELECT customer_id, invoice_number INTO v_customer, v_number
    FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_customer IS NULL THEN RETURN NEW; END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

  INSERT INTO public.customer_price_history
    (customer_id, item_id, variation_id, unit_price, quantity, source, reference_id, reference_number, created_by_email)
  VALUES
    (v_customer, NEW.item_id, NEW.variation_id, NEW.unit_price, NEW.quantity, 'invoice', NEW.invoice_id, v_number, v_email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_items_log_price
  AFTER INSERT ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.log_invoice_price_history();

-- Trigger: log quotation item prices
CREATE OR REPLACE FUNCTION public.log_quotation_price_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer UUID;
  v_number TEXT;
  v_email TEXT;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  SELECT customer_id, quotation_number INTO v_customer, v_number
    FROM public.quotations WHERE id = NEW.quotation_id;
  IF v_customer IS NULL THEN RETURN NEW; END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

  INSERT INTO public.customer_price_history
    (customer_id, item_id, variation_id, unit_price, quantity, source, reference_id, reference_number, created_by_email)
  VALUES
    (v_customer, NEW.item_id, NEW.variation_id, NEW.unit_price, NEW.quantity, 'quotation', NEW.quotation_id, v_number, v_email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotation_items_log_price
  AFTER INSERT ON public.quotation_items
  FOR EACH ROW EXECUTE FUNCTION public.log_quotation_price_history();
