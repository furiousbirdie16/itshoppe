-- What the dashboard's money cards said, each night.
--
-- Free to spend and Net Asset Value move every day, and nothing could say why:
-- asset_snapshots feeds the chart but does not hold everything these cards use
-- (bills due within 30 days, the owner's balance, each branch's own cost).
-- This keeps the same figures the dashboard works out, line by line, so
-- "then" against "now" adds up exactly. asset_snapshots is left as it is.

CREATE TABLE IF NOT EXISTS public.finance_snapshots (
  snapshot_date DATE PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  inventory NUMERIC NOT NULL DEFAULT 0,
  reserved NUMERIC NOT NULL DEFAULT 0,
  receivables NUMERIC NOT NULL DEFAULT 0,
  incoming NUMERIC NOT NULL DEFAULT 0,
  cash NUMERIC NOT NULL DEFAULT 0,
  supplier_pos NUMERIC NOT NULL DEFAULT 0,
  bills_owed_now NUMERIC NOT NULL DEFAULT 0,
  bills_due_soon NUMERIC NOT NULL DEFAULT 0,
  -- Positive: the company owes the owner. Negative: the owner owes the company.
  due_to_owner NUMERIC NOT NULL DEFAULT 0,
  loans NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE public.finance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read finance snapshots" ON public.finance_snapshots;
CREATE POLICY "Admins read finance snapshots"
  ON public.finance_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.generate_finance_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_month_end DATE;
  v_deferred TEXT[];
  v_inventory NUMERIC;
  v_reserved NUMERIC;
  v_receivables NUMERIC;
  v_incoming NUMERIC;
  v_deposits NUMERIC;
  v_supplier NUMERIC;
  v_cash NUMERIC := 0;
  v_owed_now NUMERIC;
  v_due_soon NUMERIC;
  v_owner NUMERIC;
  v_loans NUMERIC;
  r_account RECORD;
  r_txn RECORD;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_avg NUMERIC;
  v_php NUMERIC;
BEGIN
  v_month_end := (date_trunc('month', v_today) + INTERVAL '1 month - 1 day')::date;

  -- Stock on hand at each branch's own cost, archived items left out.
  SELECT COALESCE(SUM(bs.quantity * COALESCE(bs.cost_price, i.cost_price)), 0) INTO v_inventory
  FROM public.item_branch_stock bs
  JOIN public.items i ON i.id = bs.item_id
  WHERE i.status::text IS DISTINCT FROM 'archived';

  v_reserved := public.reserved_stock_value(NULL);

  -- Overseas goods paid for and not arrived, plus deposits on unpaid orders.
  SELECT COALESCE(SUM(
    GREATEST(li.quantity - li.received_quantity, 0) * COALESCE(li.unit_cost, 0) * COALESCE(NULLIF(po.exchange_rate, 0), 1)
  ), 0) INTO v_incoming
  FROM public.overseas_purchase_order_items li
  JOIN public.overseas_purchase_orders po ON po.id = li.po_id
  WHERE po.status::text IN ('paid_not_shipped', 'shipped', 'partially_received', 'pending_cargo_adjustment', 'cargo_adjusted');

  SELECT COALESCE(SUM(p.php_amount), 0) INTO v_deposits
  FROM public.overseas_po_payments p
  JOIN public.overseas_purchase_orders po ON po.id = p.po_id
  WHERE po.status::text IN ('unpaid', 'draft', 'sent', 'shipped_not_paid');
  v_incoming := v_incoming + v_deposits;

  -- Owed to suppliers, less those deposits.
  SELECT COALESCE(SUM(GREATEST(li.quantity - li.received_quantity, 0) * COALESCE(li.unit_cost, 0)), 0) INTO v_supplier
  FROM public.purchase_order_items li
  JOIN public.purchase_orders po ON po.id = li.po_id
  WHERE po.status::text <> 'received';

  v_supplier := v_supplier + COALESCE((
    SELECT SUM(GREATEST(li.quantity - li.received_quantity, 0) * COALESCE(li.unit_cost, 0) * COALESCE(NULLIF(po.exchange_rate, 0), 1))
    FROM public.overseas_purchase_order_items li
    JOIN public.overseas_purchase_orders po ON po.id = li.po_id
    WHERE po.status::text IN ('unpaid', 'draft', 'sent', 'shipped_not_paid')
  ), 0);
  v_supplier := GREATEST(v_supplier - v_deposits, 0);

  SELECT COALESCE(SUM(total_amount), 0) INTO v_receivables
  FROM public.invoices WHERE status::text IN ('confirmed', 'unpaid', 'shipped');
  v_receivables := v_receivables + COALESCE((SELECT SUM(amount) FROM public.manual_receivables WHERE status <> 'paid'), 0);

  -- Cash and bank in pesos. Foreign accounts at weighted-average cost, replayed
  -- as lib/fx.ts does: going overdrawn keeps the last rate and is not reset.
  FOR r_account IN
    SELECT id, COALESCE(currency, 'PHP') AS currency, COALESCE(opening_balance, 0) AS opening_balance
    FROM public.cash_accounts
    WHERE is_active AND account_type IN ('petty_cash', 'bank')
  LOOP
    IF r_account.currency = 'PHP' THEN
      v_cash := v_cash + r_account.opening_balance + COALESCE((
        SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)
        FROM public.cash_transactions WHERE account_id = r_account.id
      ), 0);
    ELSE
      v_qty := 0; v_cost := 0; v_avg := 0;
      FOR r_txn IN
        SELECT direction, amount, fx_rate FROM public.cash_transactions
        WHERE account_id = r_account.id ORDER BY txn_date, created_at
      LOOP
        IF r_txn.direction = 'in' THEN
          v_php := ROUND(r_txn.amount * COALESCE(NULLIF(r_txn.fx_rate, 0), v_avg), 2);
          v_qty := v_qty + r_txn.amount;
          v_cost := v_cost + v_php;
        ELSE
          v_php := ROUND(r_txn.amount * v_avg, 2);
          v_qty := v_qty - r_txn.amount;
          v_cost := v_cost - v_php;
        END IF;
        IF v_qty > 0 THEN v_avg := ROUND(v_cost / v_qty, 2); END IF;
      END LOOP;
      v_cash := v_cash + v_cost;
    END IF;
  END LOOP;

  -- Payables. Deferred categories (Settings; Rent until set) count toward net
  -- worth once due by month end, against cash once due within 30 days. Undated
  -- ones, and every other category, count in full.
  SELECT COALESCE(
    (SELECT ARRAY(SELECT lower(btrim(c)) FROM jsonb_array_elements_text(s.value -> 'categories') AS c)
     FROM public.app_settings s
     WHERE s.key = 'deferred_payable_categories' AND jsonb_typeof(s.value -> 'categories') = 'array'),
    ARRAY['rent']
  ) INTO v_deferred;

  SELECT
    COALESCE(SUM(GREATEST(amount - amount_paid, 0)) FILTER (WHERE NOT (
      lower(btrim(COALESCE(category, ''))) = ANY (v_deferred) AND due_date IS NOT NULL AND due_date > v_month_end
    )), 0),
    COALESCE(SUM(GREATEST(amount - amount_paid, 0)) FILTER (WHERE NOT (
      lower(btrim(COALESCE(category, ''))) = ANY (v_deferred) AND due_date IS NOT NULL AND due_date > v_today + 30
    )), 0)
  INTO v_owed_now, v_due_soon
  FROM public.payables
  WHERE status::text NOT IN ('paid', 'cleared', 'cancelled');

  -- The owner's account: spent for the company, less repaid, less opening.
  SELECT
    COALESCE((SELECT SUM(CASE WHEN t.direction = 'out' THEN t.amount ELSE -t.amount END)
              FROM public.cash_transactions t
              JOIN public.cash_accounts a ON a.id = t.account_id
              WHERE a.account_type = 'owner' AND a.is_active), 0)
    - COALESCE((SELECT SUM(COALESCE(opening_balance, 0)) FROM public.cash_accounts WHERE account_type = 'owner' AND is_active), 0)
  INTO v_owner;

  SELECT COALESCE(SUM(principal_amount), 0) INTO v_loans FROM public.loans;

  INSERT INTO public.finance_snapshots
    (snapshot_date, captured_at, inventory, reserved, receivables, incoming, cash, supplier_pos,
     bills_owed_now, bills_due_soon, due_to_owner, loans)
  VALUES
    (v_today, now(), v_inventory, v_reserved, v_receivables, v_incoming, v_cash, v_supplier,
     v_owed_now, v_due_soon, v_owner, v_loans)
  ON CONFLICT (snapshot_date) DO UPDATE SET
    captured_at = EXCLUDED.captured_at,
    inventory = EXCLUDED.inventory,
    reserved = EXCLUDED.reserved,
    receivables = EXCLUDED.receivables,
    incoming = EXCLUDED.incoming,
    cash = EXCLUDED.cash,
    supplier_pos = EXCLUDED.supplier_pos,
    bills_owed_now = EXCLUDED.bills_owed_now,
    bills_due_soon = EXCLUDED.bills_due_soon,
    due_to_owner = EXCLUDED.due_to_owner,
    loans = EXCLUDED.loans;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_finance_snapshot() FROM PUBLIC, anon, authenticated;

-- Nightly at 23:59 Asia/Manila = 15:59 UTC, beside the chart's own snapshot.
SELECT cron.schedule(
  'daily-finance-snapshot',
  '59 15 * * *',
  $cron$ SELECT public.generate_finance_snapshot(); $cron$
);

-- A first record now, so there is something to compare with from today.
SELECT public.generate_finance_snapshot();
