-- Net Asset Value: the daily snapshot counts post-dated rent the way the
-- dashboard card does.
--
-- The card leaves payables in the deferred categories (Rent unless changed in
-- Settings) out of what is owed until the month they fall due. The snapshot
-- counted every unpaid payable, so the chart sat below the card by the rent
-- dated after this month (₱456,000 on 2026-10-29).
--
-- Only step 6 (liabilities) changes; the rest is the function as last defined
-- in 20260911000000_overseas_po_down_payments.sql. Snapshots already taken are
-- left as they are; today's is rebuilt at the end.

CREATE OR REPLACE FUNCTION public.generate_asset_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := CURRENT_DATE;
  v_inv NUMERIC := 0;
  v_reserved NUMERIC := 0;
  v_incoming NUMERIC := 0;
  v_deposits NUMERIC := 0;
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
  v_month_end DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_deferred TEXT[];
BEGIN
  -- 1) Inventory on hand at current cost, archived items excluded.
  SELECT COALESCE(SUM(bs.quantity * i.cost_price), 0) INTO v_inv
  FROM public.item_branch_stock bs
  JOIN public.items i ON i.id = bs.item_id
  WHERE i.status::text IS DISTINCT FROM 'archived';

  -- 1b) Reserved stock, already out of item_branch_stock but not yet sold.
  v_reserved := public.reserved_stock_value(NULL);

  -- 2) Incoming assets: overseas POs already paid for and not yet arrived.
  SELECT COALESCE(SUM(
    GREATEST(li.quantity - li.received_quantity, 0)
      * COALESCE(li.unit_cost, 0)
      * COALESCE(po.exchange_rate, 1)
  ), 0) INTO v_incoming
  FROM public.overseas_purchase_order_items li
  JOIN public.overseas_purchase_orders po ON po.id = li.po_id
  WHERE po.status IN ('paid_not_shipped', 'shipped', 'partially_received',
                      'pending_cargo_adjustment', 'cargo_adjusted');

  -- 2b) Deposits on orders not yet fully paid, at what they cost in pesos.
  SELECT COALESCE(SUM(p.php_amount), 0) INTO v_deposits
  FROM public.overseas_po_payments p
  JOIN public.overseas_purchase_orders po ON po.id = p.po_id
  WHERE po.status IN ('unpaid', 'draft', 'sent', 'shipped_not_paid');
  v_incoming := v_incoming + v_deposits;

  -- 3) Supplier POs still owed, less what has already been paid toward them.
  --    Reference only — in neither side of NAV.
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
  ), 0) - v_deposits;
  v_supplier_po := GREATEST(v_supplier_po, 0);

  -- 4) Receivables: open invoices plus unpaid manual receivables.
  SELECT COALESCE(SUM(total_amount), 0) INTO v_recv
  FROM public.invoices WHERE status::text IN ('confirmed', 'unpaid', 'shipped');
  v_recv := v_recv + COALESCE((
    SELECT SUM(amount) FROM public.manual_receivables WHERE status <> 'paid'
  ), 0);

  -- 5) Cash and bank, in PHP. The owner account is a debt, not cash.
  FOR r_account IN
    SELECT id, COALESCE(currency, 'PHP') AS currency, COALESCE(opening_balance, 0) AS opening_balance
    FROM public.cash_accounts
    WHERE is_active AND account_type <> 'owner'
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
  --    Payables in the deferred categories (Settings; Rent until set) count
  --    only once due by the end of this month, as on the dashboard card: a
  --    year of post-dated rent checks is one month of rent owed now. Undated
  --    ones, and every other category, count in full.
  --    An empty list in Settings defers nothing; no setting at all means Rent.
  SELECT COALESCE(
    (SELECT ARRAY(SELECT lower(btrim(c)) FROM jsonb_array_elements_text(s.value -> 'categories') AS c)
     FROM public.app_settings s
     WHERE s.key = 'deferred_payable_categories'
       AND jsonb_typeof(s.value -> 'categories') = 'array'),
    ARRAY['rent']
  ) INTO v_deferred;

  SELECT COALESCE(SUM(GREATEST(amount - amount_paid, 0)), 0) INTO v_bills
  FROM public.payables
  WHERE status NOT IN ('paid', 'cleared', 'cancelled')
    AND NOT (
      lower(btrim(COALESCE(category, ''))) = ANY (v_deferred)
      AND due_date IS NOT NULL
      AND due_date > v_month_end
    );

  SELECT COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount ELSE -t.amount END), 0)
  INTO v_owner
  FROM public.cash_transactions t
  JOIN public.cash_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'owner';
  v_owner := GREATEST(v_owner, 0);

  SELECT COALESCE(SUM(principal_amount), 0) INTO v_loans FROM public.loans;

  v_nav := (v_inv + v_reserved + v_recv + v_incoming + v_cash) - (v_bills + v_owner + v_loans);

  INSERT INTO public.asset_snapshots
    (snapshot_date, inventory_value, incoming_stock_value, payable_assets_value,
     incoming_assets_value, accounts_payable_value, receivables_value, total_asset_value,
     cash_value, bills_payable_value, owner_due_value, loans_outstanding_value,
     reserved_stock_value, net_asset_value, captured_at)
  VALUES
    (v_date, v_inv, v_incoming, v_supplier_po,
     v_incoming, v_supplier_po, v_recv, v_inv + v_reserved + v_recv + v_incoming + v_cash,
     v_cash, v_bills, v_owner, v_loans,
     v_reserved, v_nav, now())
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
    reserved_stock_value = EXCLUDED.reserved_stock_value,
    net_asset_value = EXCLUDED.net_asset_value,
    captured_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_asset_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_asset_snapshot() TO authenticated;

SELECT public.generate_asset_snapshot();
