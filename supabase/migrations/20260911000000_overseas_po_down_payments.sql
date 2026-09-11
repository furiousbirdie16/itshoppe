-- Down payments on overseas POs.
--
-- A PO could only be paid all at once: one withdrawal, posted when the status
-- flipped to paid. Suppliers often take a deposit first and the balance later,
-- and there was nowhere to record that — so the deposit either went unrecorded
-- or was entered as a loose bank outflow nothing tied back to the order.
--
-- Each payment here is its own withdrawal. Marking the PO paid then takes out
-- only what is left, so the order is never paid for twice.

CREATE TABLE IF NOT EXISTS public.overseas_po_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.overseas_purchase_orders(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- In the PO's own currency: RMB for an RMB order, because that is what left
  -- the account.
  amount NUMERIC NOT NULL CHECK (amount > 0),
  -- Null records the payment without moving money, rather than guessing.
  cash_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  -- What the payment cost in pesos, fixed when it was made. A deposit sits on
  -- the books as an asset until the goods it paid toward arrive, and valuing it
  -- at a later rate would rewrite what it cost.
  php_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overseas_po_payments_po
  ON public.overseas_po_payments(po_id, payment_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.overseas_po_payments TO authenticated;
GRANT ALL ON public.overseas_po_payments TO service_role;
ALTER TABLE public.overseas_po_payments ENABLE ROW LEVEL SECURITY;

-- Admin only. A payment moves money out of a bank, and marking a PO paid is
-- already an admin action in the app.
CREATE POLICY "Admins can view overseas PO payments"
  ON public.overseas_po_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can insert overseas PO payments"
  ON public.overseas_po_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update overseas PO payments"
  ON public.overseas_po_payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete overseas PO payments"
  ON public.overseas_po_payments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- The withdrawal each payment produced, so deleting the payment takes the money
-- back rather than stranding it in the ledger.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS overseas_po_payment_id UUID
    REFERENCES public.overseas_po_payments(id) ON DELETE SET NULL;

-- One posting per payment: a repeat fails rather than deducting it twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_overseas_po_payment
  ON public.cash_transactions(overseas_po_payment_id) WHERE overseas_po_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Net Asset Value: a deposit is an asset.
--
-- Money paid toward an order that is not yet fully paid has left the bank, and
-- the goods do not count until the PO is paid. Without this line every deposit
-- would drop net worth by its full amount — the same hole paid-not-shipped
-- orders fell into. Once the PO is marked paid its whole value counts as
-- incoming, so deposits stop being counted separately and nothing is doubled.
-- ---------------------------------------------------------------------------
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
  SELECT COALESCE(SUM(GREATEST(amount - amount_paid, 0)), 0) INTO v_bills
  FROM public.payables WHERE status NOT IN ('paid', 'cleared', 'cancelled');

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
