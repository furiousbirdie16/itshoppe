-- Everon → IT Shoppe payment link.
--
-- Everon invoices are paid into IT Shoppe's bank and cash accounts. When one is
-- marked paid in Everon, Everon calls everon_link_payment here and the inflow
-- is recorded in the account picked; unmarking it removes the entry again.
--
-- Everon's server calls these through IT Shoppe's public API with the anon key,
-- so each function checks a shared secret first. The secret lives in a schema
-- the API cannot see, and only these functions can read it.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.link_secrets (
  name   text PRIMARY KEY,
  secret text NOT NULL
);
REVOKE ALL ON private.link_secrets FROM PUBLIC, anon, authenticated;

-- One entry per Everon invoice: the second "paid" for the same invoice updates
-- it instead of adding another.
ALTER TABLE public.cash_transactions ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS cash_transactions_external_ref_key
  ON public.cash_transactions (external_ref) WHERE external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION private.everon_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(length(p_secret), 0) >= 32
     AND EXISTS (SELECT 1 FROM private.link_secrets WHERE name = 'everon' AND secret = p_secret);
$$;
REVOKE ALL ON FUNCTION private.everon_secret_ok(text) FROM PUBLIC, anon, authenticated;

-- The accounts Everon may offer in its "Paid into" picker: active peso bank
-- and petty cash accounts. Not the owner's account, and not foreign ones,
-- which would need an exchange rate.
CREATE OR REPLACE FUNCTION public.everon_link_accounts(p_secret text)
RETURNS TABLE (id uuid, name text, account_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.everon_secret_ok(p_secret) THEN
    RAISE EXCEPTION 'Everon link: wrong secret' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
    SELECT a.id, a.name, a.account_type
      FROM public.cash_accounts a
     WHERE a.is_active
       AND a.account_type IN ('bank', 'petty_cash')
       AND upper(coalesce(nullif(a.currency, ''), 'PHP')) = 'PHP'
     ORDER BY a.account_type, a.sort_order, a.name;
END;
$$;

-- p_action 'paid' records (or corrects) the inflow; 'unpaid' removes it.
-- p_invoice_id is Everon's own id for the invoice, which never changes;
-- p_invoice_number is what people see (INV-00123).
CREATE OR REPLACE FUNCTION public.everon_link_payment(
  p_secret         text,
  p_action         text,
  p_invoice_id     text,
  p_invoice_number text DEFAULT '',
  p_customer       text DEFAULT '',
  p_amount         numeric DEFAULT NULL,
  p_account_id     uuid DEFAULT NULL,
  p_paid_on        date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ref     text;
  v_id      uuid;
  v_removed integer;
BEGIN
  IF NOT private.everon_secret_ok(p_secret) THEN
    RAISE EXCEPTION 'Everon link: wrong secret' USING ERRCODE = '28000';
  END IF;
  IF coalesce(btrim(p_invoice_id), '') = '' THEN
    RAISE EXCEPTION 'Everon link: invoice id is required';
  END IF;
  v_ref := 'everon:' || btrim(p_invoice_id);

  IF p_action = 'unpaid' THEN
    -- An invoice paid before the link existed has no entry here (it was added
    -- by hand), so there is nothing to remove and that is not an error.
    DELETE FROM public.cash_transactions WHERE external_ref = v_ref;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'action', 'unpaid', 'removed', v_removed);
  END IF;

  IF p_action <> 'paid' THEN
    RAISE EXCEPTION 'Everon link: action must be paid or unpaid, not %', p_action;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Everon link: amount must be more than 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_accounts a
     WHERE a.id = p_account_id
       AND a.is_active
       AND a.account_type IN ('bank', 'petty_cash')
       AND upper(coalesce(nullif(a.currency, ''), 'PHP')) = 'PHP'
  ) THEN
    RAISE EXCEPTION 'Everon link: pick an active peso bank or cash account in IT Shoppe';
  END IF;

  INSERT INTO public.cash_transactions AS t
    (account_id, txn_date, direction, amount, category, payee, reference, notes,
     created_by_email, updated_by_email, external_ref)
  VALUES
    (p_account_id, coalesce(p_paid_on, current_date), 'in', round(p_amount, 2),
     'Everon payment', coalesce(btrim(p_customer), ''),
     btrim('Everon ' || coalesce(btrim(p_invoice_number), '')),
     'Recorded automatically when marked paid in Everon',
     'Everon', 'Everon', v_ref)
  ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO UPDATE
    SET account_id       = EXCLUDED.account_id,
        txn_date         = EXCLUDED.txn_date,
        amount           = EXCLUDED.amount,
        payee            = EXCLUDED.payee,
        reference        = EXCLUDED.reference,
        updated_by_email = 'Everon'
  RETURNING t.id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'action', 'paid', 'transaction_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.everon_link_accounts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.everon_link_payment(text, text, text, text, text, numeric, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.everon_link_accounts(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.everon_link_payment(text, text, text, text, text, numeric, uuid, date) TO anon, authenticated;

-- The shared secret, made once. Run the SELECT to read it and copy it into
-- Everon; running this file again keeps the same one.
INSERT INTO private.link_secrets (name, secret)
VALUES ('everon', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;

SELECT secret AS everon_link_secret FROM private.link_secrets WHERE name = 'everon';
