-- Bring the daily asset snapshot in line with the Dashboard's Net Asset Value.
--
-- The old snapshot predated the finance module: it knew nothing about cash, bank,
-- loans, owner balances or bills, counted every open local PO as an incoming
-- asset, and — despite plotting receivables — left them out of the total. The two
-- figures could never agree.
--
-- Net Asset Value here matches src/pages/DashboardPage.tsx exactly:
--   (inventory + receivables + incoming assets + cash) - (bills + owed to owner + loans)
-- Supplier POs are excluded from both sides: an unpaid order is not counted as an
-- incoming asset, so counting it as a liability alone understates net worth.

ALTER TABLE public.asset_snapshots
  ADD COLUMN IF NOT EXISTS cash_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bills_payable_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_due_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loans_outstanding_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_asset_value NUMERIC NOT NULL DEFAULT 0;

-- The previous version returned a different type, and CREATE OR REPLACE cannot
-- change a return type. Dropping is safe: the cron job and the client RPC both
-- reference it by name and pick up the new definition.
DROP FUNCTION IF EXISTS public.generate_asset_snapshot();

CREATE FUNCTION public.generate_asset_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := CURRENT_DATE;
  v_inv NUMERIC := 0;
  v_incoming NUMERIC := 0;
  v_supplier_po NUMERIC := 0;
  v_recv NUMERIC := 0;
  v_cash NUMERIC := 0;
  v_bills NUMERIC := 0;
  v_owner NUMERIC := 0;
  v_loans NUMERIC := 0;
  v_nav NUMERIC := 0;
  r_account RECORD;
  r_txn RECORD;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_avg NUMERIC;
BEGIN
  -- 1) Inventory on hand at current cost, valued from item_branch_stock — the
  --    single source of truth for quantities, as getDashboardStats uses. The
  --    denormalised items.quantity column has drifted from it and would overstate.
  SELECT COALESCE(SUM(bs.quantity * i.cost_price), 0) INTO v_inv
  FROM public.item_branch_stock bs
  JOIN public.items i ON i.id = bs.item_id;

  -- 2) Incoming assets: overseas POs already paid AND shipped. Matches
  --    getDashboardStats, where local POs never count as incoming.
  SELECT COALESCE(SUM(
    GREATEST(li.quantity - li.received_quantity, 0)
      * COALESCE(li.unit_cost, 0)
      * COALESCE(po.exchange_rate, 1)
  ), 0) INTO v_incoming
  FROM public.overseas_purchase_order_items li
  JOIN public.overseas_purchase_orders po ON po.id = li.po_id
  WHERE po.status = 'shipped';

  -- 3) Supplier POs still owed. Recorded for reference only — deliberately in
  --    neither side of Net Asset Value.
  SELECT COALESCE(SUM(
    GREATEST(li.quantity - li.received_quantity, 0) * COALESCE(li.unit_cost, 0)
  ), 0) INTO v_supplier_po
  FROM public.purchase_order_items li
  JOIN public.purchase_orders po ON po.id = li.po_id
  WHERE po.status::text <> 'received';

  v_supplier_po := v_supplier_po + COALESCE((
    SELECT SUM(
      GREATEST(li.quantity - li.received_quantity, 0)
        * COALESCE(li.unit_cost, 0)
        * COALESCE(po.exchange_rate, 1)
    )
    FROM public.overseas_purchase_order_items li
    JOIN public.overseas_purchase_orders po ON po.id = li.po_id
    WHERE po.status IN ('unpaid', 'draft', 'sent', 'shipped_not_paid')
  ), 0);

  -- 4) Receivables: open invoices plus unpaid manual receivables.
  SELECT COALESCE(SUM(total_amount), 0) INTO v_recv
  FROM public.invoices WHERE status::text IN ('confirmed', 'unpaid', 'shipped');
  v_recv := v_recv + COALESCE((
    SELECT SUM(amount) FROM public.manual_receivables WHERE status <> 'paid'
  ), 0);

  -- 5) Cash and bank, in PHP.
  --    PHP accounts are opening balance plus net movement. Foreign accounts are
  --    replayed oldest-first at a weighted-average cost, mirroring src/lib/fx.ts:
  --    inflows add units at the rate paid, outflows consume at the average.
  FOR r_account IN
    SELECT id, COALESCE(currency, 'PHP') AS currency, COALESCE(opening_balance, 0) AS opening_balance
    FROM public.cash_accounts WHERE is_active
  LOOP
    IF r_account.currency = 'PHP' THEN
      v_cash := v_cash + r_account.opening_balance + COALESCE((
        SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)
        FROM public.cash_transactions WHERE account_id = r_account.id
      ), 0);
    ELSE
      v_qty := 0;
      v_cost := 0;
      v_avg := 0;
      FOR r_txn IN
        SELECT direction, amount, fx_rate
        FROM public.cash_transactions
        WHERE account_id = r_account.id
        ORDER BY txn_date, created_at
      LOOP
        IF r_txn.direction = 'in' THEN
          v_qty := v_qty + r_txn.amount;
          v_cost := v_cost + r_txn.amount * COALESCE(NULLIF(r_txn.fx_rate, 0), v_avg);
        ELSE
          v_qty := v_qty - r_txn.amount;
          v_cost := v_cost - r_txn.amount * v_avg;
        END IF;
        IF v_qty <= 0 THEN
          v_qty := 0;
          v_cost := 0;
          v_avg := 0;
        ELSE
          v_avg := ROUND(v_cost / v_qty, 2);
        END IF;
      END LOOP;
      v_cash := v_cash + v_cost;
    END IF;
  END LOOP;

  -- 6) Liabilities.
  SELECT COALESCE(SUM(GREATEST(amount - amount_paid, 0)), 0) INTO v_bills
  FROM public.payables WHERE status NOT IN ('paid', 'cleared', 'cancelled');

  SELECT COALESCE(SUM(CASE WHEN txn_type = 'owner_paid' THEN amount ELSE -amount END), 0)
  INTO v_owner FROM public.owner_transactions;
  -- An overpaid owner is not a negative liability; it would inflate net worth.
  v_owner := GREATEST(v_owner, 0);

  SELECT COALESCE(SUM(principal_amount), 0) INTO v_loans FROM public.loans;

  v_nav := (v_inv + v_recv + v_incoming + v_cash) - (v_bills + v_owner + v_loans);

  INSERT INTO public.asset_snapshots
    (snapshot_date, inventory_value, incoming_stock_value, payable_assets_value,
     incoming_assets_value, accounts_payable_value, receivables_value, total_asset_value,
     cash_value, bills_payable_value, owner_due_value, loans_outstanding_value,
     net_asset_value, captured_at)
  VALUES
    (v_date, v_inv, v_incoming, v_supplier_po,
     v_incoming, v_supplier_po, v_recv, v_inv + v_recv + v_incoming + v_cash,
     v_cash, v_bills, v_owner, v_loans,
     v_nav, now())
  ON CONFLICT (snapshot_date) DO UPDATE SET
    inventory_value = EXCLUDED.inventory_value,
    incoming_stock_value = EXCLUDED.incoming_stock_value,
    payable_assets_value = EXCLUDED.payable_assets_value,
    incoming_assets_value = EXCLUDED.incoming_assets_value,
    accounts_payable_value = EXCLUDED.accounts_payable_value,
    receivables_value = EXCLUDED.receivables_value,
    total_asset_value = EXCLUDED.total_asset_value,
    cash_value = EXCLUDED.cash_value,
    bills_payable_value = EXCLUDED.bills_payable_value,
    owner_due_value = EXCLUDED.owner_due_value,
    loans_outstanding_value = EXCLUDED.loans_outstanding_value,
    net_asset_value = EXCLUDED.net_asset_value,
    captured_at = now();
END;
$$;
