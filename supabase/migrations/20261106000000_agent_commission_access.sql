-- Agents see their own commission.
--
-- Each sales agent can be tied to the login they use. Signed in, an agent can
-- read their own month on the Commission page: the lines, the deductions and
-- what was saved when the month was closed. Nobody else's. Closing a month,
-- deductions and the rules stay with admins.

ALTER TABLE public.sales_agents
  ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- sales_agents is open to every signed-in user (the invoice form adds agents),
-- so without this a staff member could tie themselves to another agent and
-- read their commission, or switch commission on. Only an admin may set who an
-- agent is, whether they earn commission, and their petty cash.
CREATE OR REPLACE FUNCTION public.guard_sales_agent_commission_fields()
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
    IF NEW.user_id IS NOT NULL OR NEW.earns_commission OR NEW.petty_cash_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only an admin can set an agent''s login, commission or petty cash.';
    END IF;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.earns_commission IS DISTINCT FROM OLD.earns_commission
     OR NEW.petty_cash_account_id IS DISTINCT FROM OLD.petty_cash_account_id THEN
    RAISE EXCEPTION 'Only an admin can change an agent''s login, commission or petty cash.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sales_agent_commission_fields ON public.sales_agents;
CREATE TRIGGER trg_guard_sales_agent_commission_fields
  BEFORE INSERT OR UPDATE ON public.sales_agents
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_agent_commission_fields();

-- An admin, or the agent signed in as themselves. True in the SQL editor.
CREATE OR REPLACE FUNCTION public.can_see_agent_commission(p_agent_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.sales_agents s WHERE s.id = p_agent_id AND s.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.can_see_agent_commission(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_agent_commission(UUID) TO authenticated;

DROP POLICY IF EXISTS "Agents read own commission adjustments" ON public.commission_adjustments;
CREATE POLICY "Agents read own commission adjustments" ON public.commission_adjustments
  FOR SELECT TO authenticated USING (public.can_see_agent_commission(agent_id));

DROP POLICY IF EXISTS "Agents read own commission closings" ON public.commission_closings;
CREATE POLICY "Agents read own commission closings" ON public.commission_closings
  FOR SELECT TO authenticated USING (public.can_see_agent_commission(agent_id));

-- Same calculation as before, now open to the agent themselves, and with the
-- customer's id so customers can be counted (two customers may share a name).
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

REVOKE ALL ON FUNCTION public.commission_lines(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_lines(UUID, DATE) TO authenticated;
