
-- Per-line financials (admin-only)
CREATE TABLE public.invoice_item_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  variation_id UUID,
  cost_snapshot NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_total_cost NUMERIC NOT NULL DEFAULT 0,
  line_profit NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_item_financials_uniq
  ON public.invoice_item_financials (invoice_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_item_financials TO authenticated;
GRANT ALL ON public.invoice_item_financials TO service_role;

ALTER TABLE public.invoice_item_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view invoice item financials"
  ON public.invoice_item_financials FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins modify invoice item financials"
  ON public.invoice_item_financials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_invoice_item_financials_updated
BEFORE UPDATE ON public.invoice_item_financials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-invoice financials (admin-only)
CREATE TABLE public.invoice_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
  total_sales NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  total_profit NUMERIC NOT NULL DEFAULT 0,
  profit_margin NUMERIC NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_financials TO authenticated;
GRANT ALL ON public.invoice_financials TO service_role;

ALTER TABLE public.invoice_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view invoice financials"
  ON public.invoice_financials FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins modify invoice financials"
  ON public.invoice_financials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_invoice_financials_updated
BEFORE UPDATE ON public.invoice_financials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: snapshot cost when an invoice line is inserted.
-- Uses UPSERT so if the same product/variation was re-inserted after an edit-recreate,
-- the ORIGINAL cost_snapshot is preserved and only quantity/unit_price/derived totals refresh.
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost NUMERIC := 0;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(cost_price, 0) INTO v_cost FROM public.items WHERE id = NEW.item_id;
  IF v_cost IS NULL THEN v_cost := 0; END IF;

  INSERT INTO public.invoice_item_financials
    (invoice_id, item_id, variation_id, cost_snapshot, quantity, unit_price, line_total_cost, line_profit)
  VALUES
    (NEW.invoice_id, NEW.item_id, NEW.variation_id, v_cost,
     COALESCE(NEW.quantity, 0), COALESCE(NEW.unit_price, 0),
     v_cost * COALESCE(NEW.quantity, 0),
     (COALESCE(NEW.unit_price, 0) - v_cost) * COALESCE(NEW.quantity, 0))
  ON CONFLICT (invoice_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    line_total_cost = invoice_item_financials.cost_snapshot * EXCLUDED.quantity,
    line_profit = (EXCLUDED.unit_price - invoice_item_financials.cost_snapshot) * EXCLUDED.quantity,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_invoice_item_cost
AFTER INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_item_cost();

-- Trigger: recompute invoice financial summary when status hits paid/completed.
CREATE OR REPLACE FUNCTION public.recompute_invoice_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_profit NUMERIC := 0;
  v_margin NUMERIC := 0;
BEGIN
  IF NEW.status NOT IN ('paid', 'completed') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_sales
    FROM public.invoice_items WHERE invoice_id = NEW.id;
  SELECT COALESCE(SUM(line_total_cost), 0) INTO v_cost
    FROM public.invoice_item_financials WHERE invoice_id = NEW.id;
  v_profit := v_sales - v_cost;
  IF v_sales > 0 THEN v_margin := (v_profit / v_sales) * 100; ELSE v_margin := 0; END IF;

  INSERT INTO public.invoice_financials
    (invoice_id, total_sales, total_cost, total_profit, profit_margin, paid_at)
  VALUES
    (NEW.id, v_sales, v_cost, v_profit, v_margin, now())
  ON CONFLICT (invoice_id) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_cost = EXCLUDED.total_cost,
    total_profit = EXCLUDED.total_profit,
    profit_margin = EXCLUDED.profit_margin,
    paid_at = COALESCE(invoice_financials.paid_at, EXCLUDED.paid_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recompute_invoice_financials
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.recompute_invoice_financials();
