-- Sales agent commission, worked out from the invoices themselves.
--
-- Until now each agent kept a sheet of what they sold, and the commission was
-- added up by hand from that sheet. Every line on it is already an invoice
-- line here, so this computes the same thing from the ERP: no second record to
-- keep in step, and nothing to cross-check.
--
-- How a line is coded (the rules the agents' sheets used):
--   1. The item's category decides first: Brands -> B, Wires -> O,
--      TP-Link / SD Card -> TP (editable in commission_categories).
--   2. Otherwise the price against the dealer price (DP):
--        below DP2 (DP x 95%)      -> BD2
--        below DP, DP2 or above    -> BD1
--        DP or above               -> N
-- A sale counts in the month it was paid, and only once it is paid.

-- ---------------------------------------------------------------------------
-- 1. Dealer price
-- ---------------------------------------------------------------------------
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS dealer_price NUMERIC CHECK (dealer_price IS NULL OR dealer_price >= 0);

-- Blank on a variation = worked out from the item's, the same way a
-- variation's cost is: DP x factor / units per stock.
ALTER TABLE public.item_variations
  ADD COLUMN IF NOT EXISTS dealer_price NUMERIC CHECK (dealer_price IS NULL OR dealer_price >= 0);

-- The DP decides an agent's commission, and staff can edit items. Only an
-- admin may set or change it. auth.uid() is NULL in the SQL editor and in
-- migrations, which are run by the owner.
CREATE OR REPLACE FUNCTION public.guard_dealer_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.dealer_price IS NOT NULL THEN
      RAISE EXCEPTION 'Only an admin can set the dealer price (DP).';
    END IF;
  ELSIF NEW.dealer_price IS DISTINCT FROM OLD.dealer_price THEN
    RAISE EXCEPTION 'Only an admin can change the dealer price (DP).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_item_dealer_price ON public.items;
CREATE TRIGGER trg_guard_item_dealer_price
  BEFORE INSERT OR UPDATE OF dealer_price ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.guard_dealer_price();

DROP TRIGGER IF EXISTS trg_guard_variation_dealer_price ON public.item_variations;
CREATE TRIGGER trg_guard_variation_dealer_price
  BEFORE INSERT OR UPDATE OF dealer_price ON public.item_variations
  FOR EACH ROW EXECUTE FUNCTION public.guard_dealer_price();

-- ---------------------------------------------------------------------------
-- 2. The day an invoice was paid
--
-- invoice_financials.paid_at keeps the FIRST time an invoice was paid, even
-- after it is reverted and paid again later, so it can put a sale in the wrong
-- month. This one follows the status: set when the invoice becomes paid
-- (paid, or completed straight from shipped), cleared when it stops being paid.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_invoice_paid_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paid BOOLEAN := NEW.status::text IN ('paid', 'completed');
  v_was_paid BOOLEAN := TG_OP = 'UPDATE' AND OLD.status::text IN ('paid', 'completed');
BEGIN
  IF NOT v_paid THEN
    NEW.paid_at := NULL;
  ELSIF NOT v_was_paid AND NEW.paid_at IS NULL THEN
    -- Becoming paid now. Paid again after a revert lands here too, because
    -- the revert cleared the old day: the new payment's day counts.
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_invoice_paid_at ON public.invoices;
CREATE TRIGGER trg_set_invoice_paid_at
  BEFORE INSERT OR UPDATE OF status, paid_at ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_paid_at();

-- Invoices already paid. Two records of the day exist and each is wrong in
-- one case: invoice_financials.paid_at keeps the FIRST payment, so an invoice
-- reverted and paid again shows the old day; the ledger's txn_date is the
-- latest payment but was cut from UTC, so one marked paid before 8am Manila
-- shows the day before. The later of the two is right in both cases. With
-- neither, the last time the invoice changed.
UPDATE public.invoices i
SET paid_at = COALESCE(
  GREATEST(
    (SELECT (MAX(ct.txn_date)::timestamp + INTERVAL '12 hours') AT TIME ZONE 'Asia/Manila'
       FROM public.cash_transactions ct WHERE ct.source_invoice_id = i.id),
    (SELECT f.paid_at FROM public.invoice_financials f WHERE f.invoice_id = i.id)
  ),
  i.updated_at,
  i.created_at
)
WHERE i.status::text IN ('paid', 'completed') AND i.paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_paid_at ON public.invoices (paid_at) WHERE paid_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Rules: the rate of each code, and the categories that fix a code
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL CHECK (code IN ('B', 'O', 'TP', 'BD1', 'BD2', 'N')),
  -- Percent: 0.5 means 0.5%.
  rate NUMERIC NOT NULL CHECK (rate >= 0 AND rate <= 100),
  -- A new rate starts on this day; sales before it keep the old rate.
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, effective_from)
);

INSERT INTO public.commission_rates (code, rate, effective_from) VALUES
  ('B', 0.5, '2000-01-01'),
  ('O', 2, '2000-01-01'),
  ('TP', 1.5, '2000-01-01'),
  ('BD1', 3, '2000-01-01'),
  ('BD2', 2, '2000-01-01'),
  ('N', 5, '2000-01-01')
ON CONFLICT (code, effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.commission_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- As written on items.category; matched ignoring case and outer spaces.
  category TEXT NOT NULL CHECK (btrim(category) <> ''),
  code TEXT NOT NULL CHECK (code IN ('B', 'O', 'TP')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commission_categories_category_key
  ON public.commission_categories (lower(btrim(category)));

INSERT INTO public.commission_categories (category, code) VALUES
  ('Brands', 'B'),
  ('Wires', 'O'),
  ('TP-Link', 'TP'),
  ('SD Card', 'TP')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Agents: who earns commission, and their own petty cash
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_agents
  ADD COLUMN IF NOT EXISTS earns_commission BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS petty_cash_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL;

UPDATE public.sales_agents
SET earns_commission = true
WHERE lower(btrim(name)) LIKE 'geraldine%' OR lower(btrim(name)) LIKE 'melody%';

-- "Geraldine petty cash" for Geraldine, and so on, where exactly one matches.
UPDATE public.sales_agents s
SET petty_cash_account_id = (
  SELECT a.id FROM public.cash_accounts a
  WHERE a.account_type = 'petty_cash'
    AND lower(a.name) LIKE '%' || lower(split_part(btrim(s.name), ' ', 1)) || '%'
)
WHERE s.earns_commission
  AND s.petty_cash_account_id IS NULL
  AND (SELECT count(*) FROM public.cash_accounts a
        WHERE a.account_type = 'petty_cash'
          AND lower(a.name) LIKE '%' || lower(split_part(btrim(s.name), ' ', 1)) || '%') = 1;

-- ---------------------------------------------------------------------------
-- 5. Deductions and additions per agent per month, and closed months
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.sales_agents(id) ON DELETE CASCADE,
  -- First day of the month it belongs to.
  month DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
  label TEXT NOT NULL CHECK (btrim(label) <> ''),
  -- Negative for a deduction ("Jason ticket"), positive for an addition.
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_commission_adjustments_agent_month
  ON public.commission_adjustments (agent_id, month);

-- What was paid, kept as it was on the day: a DP or an invoice edited later
-- cannot change a commission already handed over.
CREATE TABLE IF NOT EXISTS public.commission_closings (
  agent_id UUID NOT NULL REFERENCES public.sales_agents(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
  sales NUMERIC NOT NULL,
  commission NUMERIC NOT NULL,
  adjustments NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  summary JSONB NOT NULL,
  lines JSONB NOT NULL,
  adjustment_lines JSONB NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by_email TEXT,
  PRIMARY KEY (agent_id, month)
);

-- ---------------------------------------------------------------------------
-- 6. Access: anyone signed in may read the rules (the invoice form shows the
--    DP); only an admin may change them or see what an agent earns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed in read commission rates" ON public.commission_rates;
CREATE POLICY "Signed in read commission rates" ON public.commission_rates
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage commission rates" ON public.commission_rates;
CREATE POLICY "Admins manage commission rates" ON public.commission_rates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Signed in read commission categories" ON public.commission_categories;
CREATE POLICY "Signed in read commission categories" ON public.commission_categories
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage commission categories" ON public.commission_categories;
CREATE POLICY "Admins manage commission categories" ON public.commission_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage commission adjustments" ON public.commission_adjustments;
CREATE POLICY "Admins manage commission adjustments" ON public.commission_adjustments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage commission closings" ON public.commission_closings;
CREATE POLICY "Admins manage commission closings" ON public.commission_closings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 7. The calculation: every invoice line an agent was paid for in a month
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_lines(p_agent_id UUID, p_month DATE)
RETURNS TABLE (
  invoice_id UUID,
  invoice_number TEXT,
  invoice_date DATE,
  paid_on DATE,
  customer TEXT,
  payment_method TEXT,
  payment_account TEXT,
  line_id UUID,
  item_id UUID,
  item_name TEXT,
  category TEXT,
  quantity NUMERIC,
  unit_price NUMERIC,
  dp NUMERIC,
  dp2 NUMERIC,
  code TEXT,
  rate NUMERIC,
  sales NUMERIC,
  commission NUMERIC,
  problems TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can see commissions.';
  END IF;

  RETURN QUERY
  WITH agent AS (
    SELECT s.id, s.name, s.petty_cash_account_id FROM public.sales_agents s WHERE s.id = p_agent_id
  ),
  inv AS (
    SELECT i.*, (i.paid_at AT TIME ZONE 'Asia/Manila')::date AS paid_day
    FROM public.invoices i, agent g
    WHERE i.status::text IN ('paid', 'completed')
      AND i.paid_at IS NOT NULL
      AND lower(btrim(COALESCE(i.sales_agent, ''))) = lower(btrim(g.name))
      AND (i.paid_at AT TIME ZONE 'Asia/Manila')::date >= v_from
      AND (i.paid_at AT TIME ZONE 'Asia/Manila')::date < v_to
  ),
  line AS (
    SELECT
      inv.id AS invoice_id, inv.invoice_number, inv.invoice_date, inv.paid_day,
      c.name AS customer, inv.payment_method, a.name AS payment_account,
      a.account_type AS account_type, a.id AS account_id,
      li.id AS line_id, li.item_id,
      COALESCE(v.name, li.item_name, it.name) AS item_name,
      NULLIF(btrim(it.category), '') AS category,
      li.quantity::numeric AS quantity, li.unit_price::numeric AS unit_price,
      CASE
        WHEN li.item_id IS NULL THEN NULL
        WHEN v.id IS NULL THEN it.dealer_price
        ELSE COALESCE(v.dealer_price,
               it.dealer_price * COALESCE(NULLIF(v.factor, 0), 1) / COALESCE(NULLIF(it.units_per_stock, 0), 1))
      END AS dp,
      cc.code AS category_code
    FROM inv
    JOIN public.invoice_items li ON li.invoice_id = inv.id
    LEFT JOIN public.items it ON it.id = li.item_id
    LEFT JOIN public.item_variations v ON v.id = li.variation_id
    LEFT JOIN public.customers c ON c.id = inv.customer_id
    LEFT JOIN public.cash_accounts a ON a.id = inv.payment_account_id
    LEFT JOIN public.commission_categories cc ON lower(btrim(cc.category)) = lower(btrim(it.category))
  ),
  coded AS (
    SELECT l.*,
      round(l.dp * 0.95, 2) AS dp2,
      CASE
        WHEN l.category_code IS NOT NULL THEN l.category_code
        WHEN l.dp IS NULL THEN NULL
        WHEN l.unit_price < l.dp * 0.95 THEN 'BD2'
        WHEN l.unit_price < l.dp THEN 'BD1'
        ELSE 'N'
      END AS code
    FROM line l
  )
  SELECT
    k.invoice_id, k.invoice_number, k.invoice_date, k.paid_day, k.customer,
    k.payment_method, k.payment_account,
    k.line_id, k.item_id, k.item_name, k.category, k.quantity, k.unit_price,
    k.dp, k.dp2, k.code, r.rate,
    k.quantity * k.unit_price AS sales,
    COALESCE(k.quantity * k.unit_price * r.rate / 100, 0) AS commission,
    array_remove(ARRAY[
      CASE WHEN k.item_id IS NULL THEN 'not_inventory_item' END,
      CASE WHEN k.item_id IS NOT NULL AND k.code IS NULL THEN 'no_dp' END,
      CASE WHEN k.code IS NOT NULL AND r.rate IS NULL THEN 'no_rate' END,
      CASE WHEN k.account_id IS NULL
             AND COALESCE(k.payment_method, '') NOT IN ('Credit Card', 'Others', 'Other') THEN 'no_account' END,
      CASE WHEN k.account_type = 'petty_cash'
             AND (SELECT g.petty_cash_account_id FROM agent g) IS NOT NULL
             AND k.account_id <> (SELECT g.petty_cash_account_id FROM agent g) THEN 'other_petty_cash' END
    ], NULL) AS problems
  FROM coded k
  LEFT JOIN LATERAL (
    SELECT cr.rate FROM public.commission_rates cr
    WHERE cr.code = k.code AND cr.effective_from <= k.paid_day
    ORDER BY cr.effective_from DESC
    LIMIT 1
  ) r ON true
  ORDER BY k.paid_day, k.invoice_number, k.line_id;
END;
$$;

-- Paid in the month with no agent, or an agent name that matches nobody: a
-- sale that may belong to Geraldine or Melody but is counted for no one.
CREATE OR REPLACE FUNCTION public.commission_unassigned_invoices(p_month DATE)
RETURNS TABLE (
  invoice_id UUID,
  invoice_number TEXT,
  paid_on DATE,
  customer TEXT,
  sales_agent TEXT,
  total_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can see commissions.';
  END IF;

  RETURN QUERY
  SELECT i.id, i.invoice_number, (i.paid_at AT TIME ZONE 'Asia/Manila')::date, c.name,
         NULLIF(btrim(i.sales_agent), ''), i.total_amount::numeric
  FROM public.invoices i
  LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.status::text IN ('paid', 'completed')
    AND i.paid_at IS NOT NULL
    AND (i.paid_at AT TIME ZONE 'Asia/Manila')::date >= v_from
    AND (i.paid_at AT TIME ZONE 'Asia/Manila')::date < v_to
    AND NOT EXISTS (
      SELECT 1 FROM public.sales_agents s
      WHERE lower(btrim(s.name)) = lower(btrim(COALESCE(i.sales_agent, '')))
    )
  ORDER BY 3, 2;
END;
$$;

-- Saves the month as it stands now. Refuses a month already closed: reopen it
-- (delete the closing) first, on purpose.
CREATE OR REPLACE FUNCTION public.close_commission_month(p_agent_id UUID, p_month DATE)
RETURNS public.commission_closings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_row public.commission_closings;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can close a commission month.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_closings WHERE agent_id = p_agent_id AND month = v_month) THEN
    RAISE EXCEPTION 'This month is already closed for this agent. Reopen it first.';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  WITH l AS (SELECT * FROM public.commission_lines(p_agent_id, v_month)),
  s AS (
    -- Rounded per code, then added: the sheet's way, and the page's.
    SELECT l.code, sum(l.sales) AS sales, round(sum(l.commission), 2) AS commission,
           min(l.rate) AS rate, count(*) AS line_count
    FROM l WHERE l.code IS NOT NULL GROUP BY l.code
  ),
  adj AS (
    SELECT * FROM public.commission_adjustments
    WHERE agent_id = p_agent_id AND month = v_month
  )
  INSERT INTO public.commission_closings
    (agent_id, month, sales, commission, adjustments, total, summary, lines, adjustment_lines, closed_by_email)
  SELECT
    p_agent_id, v_month,
    COALESCE((SELECT sum(sales) FROM s), 0),
    COALESCE((SELECT sum(commission) FROM s), 0),
    COALESCE((SELECT sum(amount) FROM adj), 0),
    COALESCE((SELECT sum(commission) FROM s), 0) + COALESCE((SELECT sum(amount) FROM adj), 0),
    COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.code) FROM s), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM l), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', adj.label, 'amount', adj.amount) ORDER BY adj.created_at) FROM adj), '[]'::jsonb),
    v_email
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.commission_lines(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commission_unassigned_invoices(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_commission_month(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_lines(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_unassigned_invoices(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_commission_month(UUID, DATE) TO authenticated;
