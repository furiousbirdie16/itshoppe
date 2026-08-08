-- Staff need to move money from cash into a bank, and to pick a bank when marking
-- an invoice paid — without being able to browse bank accounts or their balances.
--
-- RLS is row-level, so "may reference an account but may not read it" cannot be
-- expressed as a policy. Two SECURITY DEFINER functions carry that instead: one
-- returns just the identifying columns needed to populate a dropdown, the other
-- performs a transfer after checking the caller is allowed to make it.

-- ---------------------------------------------------------------------------
-- Close the read hole: non-admins see petty cash accounts only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view cash accounts" ON public.cash_accounts;
DROP POLICY IF EXISTS "View petty cash accounts or admin sees all" ON public.cash_accounts;
CREATE POLICY "View petty cash accounts or admin sees all"
  ON public.cash_accounts FOR SELECT
  TO authenticated
  USING (account_type = 'petty_cash' OR public.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- Names only — no balances, no account numbers, no notes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cash_account_options()
RETURNS TABLE (id UUID, name TEXT, account_type TEXT, currency TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.account_type, a.currency
  FROM public.cash_accounts a
  WHERE a.is_active
    AND auth.uid() IS NOT NULL
  ORDER BY a.account_type, a.sort_order, a.name;
$$;

REVOKE ALL ON FUNCTION public.cash_account_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_account_options() TO authenticated;

-- ---------------------------------------------------------------------------
-- Transfers. Non-admins may only send FROM a petty cash account; admins may move
-- between any two. Both legs are written here so the pair can never be half-made.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cash_transfer(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,
  p_amount_to NUMERIC DEFAULT NULL,
  p_fx_rate NUMERIC DEFAULT NULL,
  p_txn_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group UUID := gen_random_uuid();
  v_email TEXT := COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '');
  v_from_type TEXT;
  v_to_exists BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Pick two different accounts';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT account_type INTO v_from_type FROM public.cash_accounts WHERE id = p_from_account_id AND is_active;
  SELECT EXISTS (SELECT 1 FROM public.cash_accounts WHERE id = p_to_account_id AND is_active) INTO v_to_exists;
  IF v_from_type IS NULL OR NOT v_to_exists THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  -- Staff may only move money out of cash; anything leaving a bank is admin-only.
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) AND v_from_type <> 'petty_cash' THEN
    RAISE EXCEPTION 'Not allowed to transfer from this account';
  END IF;

  INSERT INTO public.cash_transactions
    (account_id, txn_date, direction, amount, category, notes, transfer_group_id, created_by, created_by_email)
  VALUES
    (p_from_account_id, p_txn_date, 'out', p_amount, 'Transfer', COALESCE(p_notes, ''), v_group, auth.uid(), v_email);

  INSERT INTO public.cash_transactions
    (account_id, txn_date, direction, amount, category, notes, transfer_group_id, fx_rate, created_by, created_by_email)
  VALUES
    (p_to_account_id, p_txn_date, 'in', COALESCE(p_amount_to, p_amount), 'Transfer', COALESCE(p_notes, ''), v_group, p_fx_rate, auth.uid(), v_email);

  RETURN v_group;
END;
$$;

REVOKE ALL ON FUNCTION public.create_cash_transfer(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_transfer(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- With transfers handled above, the blanket "any row carrying a source_invoice_id"
-- insert rule can be tightened back to what it was meant to cover: an invoice
-- payment landing in the account it was paid into.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Insert petty cash, invoice-posted, or admin any" ON public.cash_transactions;
DROP POLICY IF EXISTS "Insert petty cash txns or admin inserts any" ON public.cash_transactions;
CREATE POLICY "Insert petty cash, invoice inflow, or admin any"
  ON public.cash_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_petty_cash_account(account_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      source_invoice_id IS NOT NULL
      AND direction = 'in'
      AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = source_invoice_id)
    )
  );
