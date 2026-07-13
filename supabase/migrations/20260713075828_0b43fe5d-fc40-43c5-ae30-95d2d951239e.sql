
-- 1) Table
CREATE TABLE IF NOT EXISTS public.online_sale_financials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  online_sale_id UUID NOT NULL UNIQUE REFERENCES public.online_sales(id) ON DELETE CASCADE,
  item_id UUID,
  variation_id UUID,
  cost_snapshot NUMERIC,           -- per-unit cost at time of upload; NULL = cost not set
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0, -- posted_price snapshot
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  line_total_cost NUMERIC,         -- cost_snapshot * quantity (NULL if no cost)
  line_profit NUMERIC,             -- amount_paid - line_total_cost (NULL if no cost or unpaid)
  gross_margin NUMERIC,            -- line_profit / amount_paid * 100
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  has_cost BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_sale_financials TO authenticated;
GRANT ALL ON public.online_sale_financials TO service_role;

ALTER TABLE public.online_sale_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view online sale financials" ON public.online_sale_financials;
CREATE POLICY "Admins view online sale financials"
  ON public.online_sale_financials FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins modify online sale financials" ON public.online_sale_financials;
CREATE POLICY "Admins modify online sale financials"
  ON public.online_sale_financials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_online_sale_financials_sale ON public.online_sale_financials(online_sale_id);
CREATE INDEX IF NOT EXISTS idx_online_sale_financials_item ON public.online_sale_financials(item_id);

DROP TRIGGER IF EXISTS trg_online_sale_financials_updated ON public.online_sale_financials;
CREATE TRIGGER trg_online_sale_financials_updated
  BEFORE UPDATE ON public.online_sale_financials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Snapshot function (locks cost at upload time)
CREATE OR REPLACE FUNCTION public.snapshot_online_sale_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost NUMERIC;
  v_qty  NUMERIC := COALESCE(NEW.quantity, 0);
  v_unit NUMERIC := COALESCE(NEW.posted_price, 0);
  v_paid NUMERIC := COALESCE(NEW.amount_paid, 0);
  v_is_paid BOOLEAN := (NEW.payment_status = 'paid');
  v_line_cost NUMERIC;
  v_line_profit NUMERIC;
  v_margin NUMERIC;
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    IF NEW.variation_id IS NOT NULL THEN
      SELECT cost_price INTO v_cost FROM public.item_variations WHERE id = NEW.variation_id;
    ELSE
      SELECT cost_price INTO v_cost FROM public.items WHERE id = NEW.item_id;
    END IF;
  END IF;

  IF v_cost IS NULL THEN
    v_line_cost := NULL;
    v_line_profit := NULL;
    v_margin := NULL;
  ELSE
    v_line_cost := v_cost * v_qty;
    IF v_is_paid THEN
      v_line_profit := v_paid - v_line_cost;
      IF v_paid > 0 THEN v_margin := (v_line_profit / v_paid) * 100; ELSE v_margin := NULL; END IF;
    END IF;
  END IF;

  INSERT INTO public.online_sale_financials
    (online_sale_id, item_id, variation_id, cost_snapshot, quantity, unit_price,
     amount_paid, line_total_cost, line_profit, gross_margin, is_paid, paid_at, has_cost)
  VALUES
    (NEW.id, NEW.item_id, NEW.variation_id, v_cost, v_qty, v_unit,
     v_paid, v_line_cost, v_line_profit, v_margin, v_is_paid, NEW.paid_at, v_cost IS NOT NULL)
  ON CONFLICT (online_sale_id) DO NOTHING; -- cost is locked; don't overwrite on re-insert
  RETURN NEW;
END;
$$;

-- 3) Recompute function (only re-evaluates profit; cost stays locked)
CREATE OR REPLACE FUNCTION public.recompute_online_sale_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost NUMERIC;
  v_qty  NUMERIC := COALESCE(NEW.quantity, 0);
  v_paid NUMERIC := COALESCE(NEW.amount_paid, 0);
  v_is_paid BOOLEAN := (NEW.payment_status = 'paid');
  v_line_cost NUMERIC;
  v_line_profit NUMERIC;
  v_margin NUMERIC;
BEGIN
  SELECT cost_snapshot INTO v_cost FROM public.online_sale_financials WHERE online_sale_id = NEW.id;

  IF v_cost IS NULL THEN
    v_line_cost := NULL; v_line_profit := NULL; v_margin := NULL;
  ELSE
    v_line_cost := v_cost * v_qty;
    IF v_is_paid THEN
      v_line_profit := v_paid - v_line_cost;
      IF v_paid > 0 THEN v_margin := (v_line_profit / v_paid) * 100; END IF;
    END IF;
  END IF;

  UPDATE public.online_sale_financials
     SET quantity = v_qty,
         unit_price = COALESCE(NEW.posted_price, 0),
         amount_paid = v_paid,
         line_total_cost = v_line_cost,
         line_profit = v_line_profit,
         gross_margin = v_margin,
         is_paid = v_is_paid,
         paid_at = NEW.paid_at,
         has_cost = v_cost IS NOT NULL,
         updated_at = now()
   WHERE online_sale_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_online_sale_cost ON public.online_sales;
CREATE TRIGGER trg_snapshot_online_sale_cost
  AFTER INSERT ON public.online_sales
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_online_sale_cost();

DROP TRIGGER IF EXISTS trg_recompute_online_sale_financials ON public.online_sales;
CREATE TRIGGER trg_recompute_online_sale_financials
  AFTER UPDATE OF payment_status, amount_paid, quantity, posted_price, paid_at
  ON public.online_sales
  FOR EACH ROW EXECUTE FUNCTION public.recompute_online_sale_financials();

-- 4) Backfill existing online sales (cost = current item/variation cost as best available snapshot)
INSERT INTO public.online_sale_financials
  (online_sale_id, item_id, variation_id, cost_snapshot, quantity, unit_price,
   amount_paid, line_total_cost, line_profit, gross_margin, is_paid, paid_at, has_cost)
SELECT
  os.id,
  os.item_id,
  os.variation_id,
  c.cost_price,
  COALESCE(os.quantity, 0),
  COALESCE(os.posted_price, 0),
  COALESCE(os.amount_paid, 0),
  CASE WHEN c.cost_price IS NULL THEN NULL ELSE c.cost_price * COALESCE(os.quantity,0) END,
  CASE WHEN c.cost_price IS NULL OR os.payment_status <> 'paid' THEN NULL
       ELSE COALESCE(os.amount_paid,0) - c.cost_price * COALESCE(os.quantity,0) END,
  CASE WHEN c.cost_price IS NULL OR os.payment_status <> 'paid' OR COALESCE(os.amount_paid,0) = 0 THEN NULL
       ELSE ((COALESCE(os.amount_paid,0) - c.cost_price * COALESCE(os.quantity,0)) / COALESCE(os.amount_paid,0)) * 100 END,
  os.payment_status = 'paid',
  os.paid_at,
  c.cost_price IS NOT NULL
FROM public.online_sales os
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN os.variation_id IS NOT NULL THEN (SELECT cost_price FROM public.item_variations WHERE id = os.variation_id)
    WHEN os.item_id IS NOT NULL THEN (SELECT cost_price FROM public.items WHERE id = os.item_id)
    ELSE NULL
  END AS cost_price
) c ON true
ON CONFLICT (online_sale_id) DO NOTHING;
