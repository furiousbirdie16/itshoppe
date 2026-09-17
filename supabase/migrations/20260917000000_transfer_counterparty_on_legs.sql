-- A transfer is stored as two rows that only know their own side of it, so the
-- ledger could show "Transfer · BPI" without ever saying where the money came
-- from. The counterparty was recoverable by joining the pair on
-- transfer_group_id, but only when both accounts were on screen — a petty cash
-- to bank transfer reads as an unexplained inflow on the Bank page.
--
-- Each leg now records the other account's name in `payee`, the column the
-- ledger already renders, so both sides read as a direction wherever they
-- appear.

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
  v_from_name TEXT;
  v_to_name TEXT;
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

  SELECT account_type, name INTO v_from_type, v_from_name
  FROM public.cash_accounts WHERE id = p_from_account_id AND is_active;
  SELECT name INTO v_to_name
  FROM public.cash_accounts WHERE id = p_to_account_id AND is_active;
  IF v_from_type IS NULL OR v_to_name IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  -- Staff may only move money out of cash; anything leaving a bank is admin-only.
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) AND v_from_type <> 'petty_cash' THEN
    RAISE EXCEPTION 'Not allowed to transfer from this account';
  END IF;

  -- Each leg names the account on the other end of the transfer.
  INSERT INTO public.cash_transactions
    (account_id, txn_date, direction, amount, category, payee, notes, transfer_group_id, created_by, created_by_email)
  VALUES
    (p_from_account_id, p_txn_date, 'out', p_amount, 'Transfer', v_to_name, COALESCE(p_notes, ''), v_group, auth.uid(), v_email);

  INSERT INTO public.cash_transactions
    (account_id, txn_date, direction, amount, category, payee, notes, transfer_group_id, fx_rate, created_by, created_by_email)
  VALUES
    (p_to_account_id, p_txn_date, 'in', COALESCE(p_amount_to, p_amount), 'Transfer', v_from_name, COALESCE(p_notes, ''), v_group, p_fx_rate, auth.uid(), v_email);

  RETURN v_group;
END;
$$;

REVOKE ALL ON FUNCTION public.create_cash_transfer(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_transfer(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

-- Transfers already recorded: fill the counterparty in from the sibling leg, so
-- history reads the same way as anything recorded from here on. Only rows with
-- an empty payee are touched.
UPDATE public.cash_transactions t
SET payee = sibling_account.name
FROM public.cash_transactions sibling
JOIN public.cash_accounts sibling_account ON sibling_account.id = sibling.account_id
WHERE t.transfer_group_id IS NOT NULL
  AND sibling.transfer_group_id = t.transfer_group_id
  AND sibling.id <> t.id
  AND COALESCE(t.payee, '') = '';
