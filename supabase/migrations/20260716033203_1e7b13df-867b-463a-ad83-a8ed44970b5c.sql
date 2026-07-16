
-- Audit trail for invoice line-item cost overrides
CREATE TABLE public.invoice_item_cost_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_number TEXT,
  financial_id UUID REFERENCES public.invoice_item_financials(id) ON DELETE SET NULL,
  item_id UUID,
  variation_id UUID,
  item_name TEXT,
  previous_cost NUMERIC,
  new_cost NUMERIC NOT NULL,
  quantity NUMERIC,
  reason TEXT,
  changed_by UUID,
  changed_by_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.invoice_item_cost_history TO authenticated;
GRANT ALL ON public.invoice_item_cost_history TO service_role;

ALTER TABLE public.invoice_item_cost_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view invoice cost history"
  ON public.invoice_item_cost_history
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_iich_invoice_id ON public.invoice_item_cost_history(invoice_id);
CREATE INDEX idx_iich_created_at ON public.invoice_item_cost_history(created_at DESC);

-- Extend RPC: accept optional reason, log audit row, admins may run on ANY invoice status
CREATE OR REPLACE FUNCTION public.set_invoice_item_cost(_financial_id uuid, _new_cost numeric, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid;
  uemail text;
  f RECORD;
  inv RECORD;
  v_prev numeric;
  v_item_name text;
  v_sales numeric := 0;
  v_cost numeric := 0;
  v_profit numeric := 0;
  v_margin numeric := 0;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to override invoice item cost';
  END IF;
  IF _new_cost IS NULL OR _new_cost < 0 THEN
    RAISE EXCEPTION 'Cost must be zero or positive';
  END IF;

  SELECT * INTO f FROM public.invoice_item_financials WHERE id = _financial_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice line financial not found'; END IF;

  v_prev := f.cost_snapshot;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  SELECT invoice_number INTO inv FROM public.invoices WHERE id = f.invoice_id;

  IF f.variation_id IS NOT NULL THEN
    SELECT name INTO v_item_name FROM public.item_variations WHERE id = f.variation_id;
  END IF;
  IF v_item_name IS NULL AND f.item_id IS NOT NULL THEN
    SELECT name INTO v_item_name FROM public.items WHERE id = f.item_id;
  END IF;

  UPDATE public.invoice_item_financials
     SET cost_snapshot = _new_cost,
         line_total_cost = _new_cost * COALESCE(quantity, 0),
         line_profit = (COALESCE(unit_price, 0) - _new_cost) * COALESCE(quantity, 0),
         updated_at = now()
   WHERE id = _financial_id;

  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_sales
    FROM public.invoice_items WHERE invoice_id = f.invoice_id;
  SELECT COALESCE(SUM(line_total_cost), 0) INTO v_cost
    FROM public.invoice_item_financials
    WHERE invoice_id = f.invoice_id AND line_total_cost IS NOT NULL;
  v_profit := v_sales - v_cost;
  IF v_sales > 0 THEN v_margin := (v_profit / v_sales) * 100; END IF;

  INSERT INTO public.invoice_financials
    (invoice_id, total_sales, total_cost, total_profit, profit_margin)
  VALUES
    (f.invoice_id, v_sales, v_cost, v_profit, v_margin)
  ON CONFLICT (invoice_id) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    total_cost = EXCLUDED.total_cost,
    total_profit = EXCLUDED.total_profit,
    profit_margin = EXCLUDED.profit_margin,
    updated_at = now();

  INSERT INTO public.invoice_item_cost_history
    (invoice_id, invoice_number, financial_id, item_id, variation_id, item_name,
     previous_cost, new_cost, quantity, reason, changed_by, changed_by_email)
  VALUES
    (f.invoice_id, inv.invoice_number, f.id, f.item_id, f.variation_id, v_item_name,
     v_prev, _new_cost, f.quantity, NULLIF(_reason,''), uid, uemail);
END;
$function$;
