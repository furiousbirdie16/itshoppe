-- Owed to Everon.
--
-- Everon's customers pay into IT Shoppe's accounts (see everon_payment_link),
-- so IT Shoppe owes Everon every peso of it until it is sent over.
--
--   owed = starting balance + Everon payments in − remittances to Everon out
--
-- It is kept as one payable row, so the Dashboard, the Payables page and the
-- nightly finance snapshots all count it without each learning about Everon.
-- The row is rewritten whenever an Everon payment or remittance changes, and
-- is not edited by hand.

ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS system_key text;
CREATE UNIQUE INDEX IF NOT EXISTS payables_system_key_key
  ON public.payables (system_key) WHERE system_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_everon_payable()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_opening numeric := 0;
  v_in      numeric := 0;
  v_out     numeric := 0;
  v_owed    numeric;
  v_status  text;
BEGIN
  SELECT coalesce((s.value ->> 'amount')::numeric, 0) INTO v_opening
    FROM public.app_settings s WHERE s.key = 'everon_opening_owed';
  v_opening := coalesce(v_opening, 0);

  SELECT
    coalesce(sum(t.amount) FILTER (WHERE t.direction = 'in'  AND lower(btrim(t.category)) = 'everon payment'), 0),
    coalesce(sum(t.amount) FILTER (WHERE t.direction = 'out' AND lower(btrim(t.category)) = 'remittance to everon'), 0)
  INTO v_in, v_out
  FROM public.cash_transactions t
  WHERE lower(btrim(t.category)) IN ('everon payment', 'remittance to everon');

  v_owed := round(v_opening + v_in, 2);
  v_out  := round(v_out, 2);
  v_status := CASE
    WHEN v_owed - v_out <= 0.004 THEN 'paid'
    WHEN v_out > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  INSERT INTO public.payables AS p
    (system_key, payee, category, amount, amount_paid, status, notes)
  VALUES
    ('everon', 'Everon', 'Everon', v_owed, v_out, v_status,
     'Kept automatically from the Everon page: payments in less remittances sent.')
  ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO UPDATE
    SET amount      = EXCLUDED.amount,
        amount_paid = EXCLUDED.amount_paid,
        status      = EXCLUDED.status,
        updated_at  = now();
END;
$$;
REVOKE ALL ON FUNCTION public.sync_everon_payable() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_everon_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hit boolean := false;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_hit := lower(btrim(coalesce(NEW.category, ''))) IN ('everon payment', 'remittance to everon');
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_hit := v_hit OR lower(btrim(coalesce(OLD.category, ''))) IN ('everon payment', 'remittance to everon');
  END IF;
  IF v_hit THEN
    PERFORM public.sync_everon_payable();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_everon_payable ON public.cash_transactions;
CREATE TRIGGER trg_sync_everon_payable
  AFTER INSERT OR UPDATE OR DELETE ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_everon_payable();

-- What was already owed to Everon before the link started. Admins only.
CREATE OR REPLACE FUNCTION public.everon_set_opening_owed(p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can set what was owed to Everon';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at, updated_by)
  VALUES ('everon_opening_owed', jsonb_build_object('amount', round(coalesce(p_amount, 0), 2)), now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  PERFORM public.sync_everon_payable();
END;
$$;
REVOKE ALL ON FUNCTION public.everon_set_opening_owed(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.everon_set_opening_owed(numeric) TO authenticated;

-- Count what has come in since the link went live.
SELECT public.sync_everon_payable();
