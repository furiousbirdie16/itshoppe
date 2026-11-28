-- Agents see their sales, not their commission.
--
-- A staff member tied to a sales agent can still open the Commission page and
-- see their own paid sales for the month. The commission itself, the code and
-- rate behind it, deductions, what was saved when a month was closed, and the
-- rates table are admins only. This is enforced here, not just hidden on the
-- page, so the figures cannot be read straight from the database either.

-- Saved months and deductions carry commission amounts: admins only again.
DROP POLICY IF EXISTS "Agents read own commission adjustments" ON public.commission_adjustments;
DROP POLICY IF EXISTS "Agents read own commission closings" ON public.commission_closings;

-- With the rates and their own sales an agent could work it out. The rules
-- are only ever shown in Settings, to admins; commission_lines reads them as
-- its owner, so the calculation is unaffected.
DROP POLICY IF EXISTS "Signed in read commission rates" ON public.commission_rates;
DROP POLICY IF EXISTS "Signed in read commission categories" ON public.commission_categories;

-- Same calculation as before, with the code, rate, commission and problems
-- blanked for anyone but an admin.
DROP FUNCTION IF EXISTS public.commission_lines(UUID, DATE);
CREATE OR REPLACE FUNCTION public.commission_lines(p_agent_id UUID, p_month DATE)
RETURNS TABLE (
  invoice_id UUID,
  invoice_number TEXT,
  invoice_date DATE,
  paid_on DATE,
  customer_id UUID,
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
  -- Only an admin is told the code, rate and commission. An agent gets their
  -- sales lines with those left blank. True in the SQL editor.
  v_admin BOOLEAN := auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role);
BEGIN
  IF NOT public.can_see_agent_commission(p_agent_id) THEN
    RAISE EXCEPTION 'You can only see your own commission.';
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
      inv.customer_id, c.name AS customer, inv.payment_method, a.name AS payment_account,
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
    k.invoice_id, k.invoice_number, k.invoice_date, k.paid_day, k.customer_id, k.customer,
    k.payment_method, k.payment_account,
    k.line_id, k.item_id, k.item_name, k.category, k.quantity, k.unit_price,
    k.dp, k.dp2,
    CASE WHEN v_admin THEN k.code END AS code,
    CASE WHEN v_admin THEN r.rate END AS rate,
    k.quantity * k.unit_price AS sales,
    CASE WHEN v_admin THEN COALESCE(k.quantity * k.unit_price * r.rate / 100, 0) ELSE 0 END AS commission,
    CASE WHEN NOT v_admin THEN ARRAY[]::TEXT[] ELSE array_remove(ARRAY[
      CASE WHEN k.item_id IS NULL THEN 'not_inventory_item' END,
      CASE WHEN k.item_id IS NOT NULL AND k.code IS NULL THEN 'no_dp' END,
      CASE WHEN k.code IS NOT NULL AND r.rate IS NULL THEN 'no_rate' END,
      CASE WHEN k.account_id IS NULL
             AND COALESCE(k.payment_method, '') NOT IN ('Credit Card', 'Others', 'Other') THEN 'no_account' END,
      CASE WHEN k.account_type = 'petty_cash'
             AND (SELECT g.petty_cash_account_id FROM agent g) IS NOT NULL
             AND k.account_id <> (SELECT g.petty_cash_account_id FROM agent g) THEN 'other_petty_cash' END
    ], NULL) END AS problems
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

REVOKE ALL ON FUNCTION public.commission_lines(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_lines(UUID, DATE) TO authenticated;
