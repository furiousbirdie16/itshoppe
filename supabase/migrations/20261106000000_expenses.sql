-- Company expenses: one category list, recurring bills, and the monthly view.
--
-- Categories were free text on every bank, cash and payable entry, so
-- "Electricity", "electric" and "Meralco" were three different things and no
-- total could be trusted. They now come from one list, and each category says
-- whether money out under it is a company expense. Supplier payments,
-- repayments to the owner and loan principal are money out but not expenses.

-- ---------------------------------------------------------------------------
-- The list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  is_expense BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Rent" and "rent " are the same category.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_name
  ON public.expense_categories (lower(btrim(name)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

-- Everyone picks from the list, and anyone may add to it from the dropdown.
-- Changing or removing one rewrites how past spending is counted: admins only.
DROP POLICY IF EXISTS "Authenticated can view expense categories" ON public.expense_categories;
CREATE POLICY "Authenticated can view expense categories"
  ON public.expense_categories FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated can add expense categories" ON public.expense_categories;
CREATE POLICY "Authenticated can add expense categories"
  ON public.expense_categories FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Admins can change expense categories" ON public.expense_categories;
CREATE POLICY "Admins can change expense categories"
  ON public.expense_categories FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can delete expense categories" ON public.expense_categories;
CREATE POLICY "Admins can delete expense categories"
  ON public.expense_categories FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- The starting list.
INSERT INTO public.expense_categories (name, is_expense, sort_order) VALUES
  ('Shopee Ads', true, 10),
  ('Lazada Ads', true, 20),
  ('Salary', true, 30),
  ('Rent', true, 40),
  ('Electricity', true, 50),
  ('Water', true, 60),
  ('Internet & Phone', true, 70),
  ('Accounting', true, 80),
  ('Office Supplies', true, 90),
  ('Fuel & Transport', true, 100),
  ('Shipping & Delivery', true, 110),
  ('Repairs & Maintenance', true, 120),
  ('Taxes & Permits', true, 130),
  ('Bank Charges', true, 140),
  ('Marketing', true, 150),
  ('Meals', true, 160),
  ('Miscellaneous', true, 170),
  ('Supplier Payment', false, 500),
  ('Owner Repayment', false, 510),
  ('Loan Payment', false, 520),
  ('Sales', false, 530),
  ('Other Income', false, 540)
ON CONFLICT ((lower(btrim(name)))) DO NOTHING;

-- Every category already typed somewhere joins the list, so nothing in the
-- books points at a name the dropdown cannot show. They start as not an
-- expense; the Expenses page lists them so each can be counted or merged.
INSERT INTO public.expense_categories (name, is_expense, sort_order)
SELECT DISTINCT ON (lower(btrim(c))) btrim(c), false, 900
FROM (
  SELECT category AS c FROM public.cash_transactions
  UNION ALL
  SELECT category FROM public.payables
) used
WHERE btrim(coalesce(c, '')) <> ''
ORDER BY lower(btrim(c)), btrim(c)
ON CONFLICT ((lower(btrim(name)))) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Renaming and merging rewrite the entries that use the category, so a total
-- never splits between an old name and a new one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_expense_category(p_id UUID, p_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_name TEXT;
  new_name TEXT := btrim(coalesce(p_name, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can rename categories';
  END IF;
  IF new_name = '' THEN RAISE EXCEPTION 'Enter a name'; END IF;
  SELECT name INTO old_name FROM public.expense_categories WHERE id = p_id;
  IF old_name IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.expense_categories
             WHERE id <> p_id AND lower(btrim(name)) = lower(new_name)) THEN
    RAISE EXCEPTION '"%" already exists — merge into it instead', new_name;
  END IF;

  UPDATE public.expense_categories SET name = new_name, updated_at = now() WHERE id = p_id;
  UPDATE public.cash_transactions SET category = new_name
   WHERE lower(btrim(category)) = lower(btrim(old_name)) AND category IS DISTINCT FROM new_name;
  UPDATE public.payables SET category = new_name
   WHERE lower(btrim(category)) = lower(btrim(old_name)) AND category IS DISTINCT FROM new_name;
  UPDATE public.recurring_expenses SET category = new_name
   WHERE lower(btrim(category)) = lower(btrim(old_name)) AND category IS DISTINCT FROM new_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_expense_category(p_from UUID, p_into UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_name TEXT;
  into_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can merge categories';
  END IF;
  IF p_from = p_into THEN RAISE EXCEPTION 'Pick a different category to merge into'; END IF;
  SELECT name INTO from_name FROM public.expense_categories WHERE id = p_from;
  SELECT name INTO into_name FROM public.expense_categories WHERE id = p_into;
  IF from_name IS NULL OR into_name IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;

  UPDATE public.cash_transactions SET category = into_name
   WHERE lower(btrim(category)) = lower(btrim(from_name));
  UPDATE public.payables SET category = into_name
   WHERE lower(btrim(category)) = lower(btrim(from_name));
  UPDATE public.recurring_expenses SET category = into_name
   WHERE lower(btrim(category)) = lower(btrim(from_name));
  DELETE FROM public.expense_categories WHERE id = p_from;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recurring bills: salary, accounting, electricity, internet. Rent stays in
-- Payables, where its post-dated checks already are.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  category TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  -- The usual amount. A bill that varies (electricity) is confirmed with its
  -- real amount each month.
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- 29, 30 and 31 fall on the month's last day in a shorter month.
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  -- Posts itself on its day. Only for a fixed amount from a peso account.
  auto_post BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A month a bill did not come, so it stops showing as due.
CREATE TABLE IF NOT EXISTS public.recurring_expense_skips (
  recurring_id UUID NOT NULL REFERENCES public.recurring_expenses(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recurring_id, period)
);

-- The bank or cash withdrawal that paid a bill for a month. Kept on the
-- transaction itself, so deleting the withdrawal makes the bill due again.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS recurring_expense_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurring_period TEXT;

-- One payment per bill per month, however many tabs click Paid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_recurring_period
  ON public.cash_transactions (recurring_expense_id, recurring_period)
  WHERE recurring_expense_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expenses TO authenticated;
GRANT ALL ON public.recurring_expenses TO service_role;
GRANT SELECT, INSERT, DELETE ON public.recurring_expense_skips TO authenticated;
GRANT ALL ON public.recurring_expense_skips TO service_role;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expense_skips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage recurring expenses" ON public.recurring_expenses;
CREATE POLICY "Admins manage recurring expenses"
  ON public.recurring_expenses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins manage recurring skips" ON public.recurring_expense_skips;
CREATE POLICY "Admins manage recurring skips"
  ON public.recurring_expense_skips FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- Auto-posting, once a day in Manila time. A bill set up after its day this
-- month waits for next month rather than posting a payment that may already
-- have been made by hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_due_recurring_expenses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_period TEXT := to_char(today, 'YYYY-MM');
  last_day INTEGER := extract(day FROM (date_trunc('month', today) + interval '1 month - 1 day'))::int;
  posted INTEGER := 0;
  n INTEGER;
  r RECORD;
  due DATE;
BEGIN
  FOR r IN
    SELECT re.*
      FROM public.recurring_expenses re
      JOIN public.cash_accounts a ON a.id = re.account_id
     WHERE re.is_active AND re.auto_post AND re.amount > 0
       AND a.is_active AND upper(coalesce(a.currency, 'PHP')) = 'PHP'
  LOOP
    due := make_date(extract(year FROM today)::int, extract(month FROM today)::int, least(r.day_of_month, last_day));
    CONTINUE WHEN due > today;
    CONTINUE WHEN due < (r.created_at AT TIME ZONE 'Asia/Manila')::date;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.recurring_expense_skips s
                           WHERE s.recurring_id = r.id AND s.period = v_period);

    INSERT INTO public.cash_transactions
      (account_id, txn_date, direction, amount, category, payee, notes,
       recurring_expense_id, recurring_period, created_by_email)
    VALUES
      (r.account_id, due, 'out', r.amount, r.category, r.payee, 'Recurring: ' || r.name,
       r.id, v_period, 'auto')
    ON CONFLICT (recurring_expense_id, recurring_period) WHERE recurring_expense_id IS NOT NULL
    DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    posted := posted + n;
  END LOOP;
  RETURN posted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_due_recurring_expenses() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rename_expense_category(UUID, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.merge_expense_category(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rename_expense_category(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_expense_category(UUID, UUID) TO authenticated;

-- 00:05 Asia/Manila = 16:05 UTC.
SELECT cron.schedule(
  'post-recurring-expenses',
  '5 16 * * *',
  $cron$ SELECT public.post_due_recurring_expenses(); $cron$
);
