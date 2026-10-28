-- What was changed on a cash or bank line, and by whom.
--
-- Editing a line used to overwrite it with nothing left to say what it was:
-- a ₱100 entry corrected to ₱90 just read ₱90. Every edit to a line's
-- substance is now kept, so the ledger can show the old figure struck through
-- beside the new one, and the change can be announced.
--
-- Written by a trigger rather than the app, so an edit is recorded however it
-- is made (the Cash page, an invoice payment re-posted, a PO payment).

CREATE TABLE IF NOT EXISTS public.cash_transaction_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.cash_transactions(id) ON DELETE CASCADE,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_by_email TEXT,
  -- { "<field>": { "from": ..., "to": ... } } for each field that changed.
  changes JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_transaction_edits_txn ON public.cash_transaction_edits (transaction_id, edited_at DESC);

ALTER TABLE public.cash_transaction_edits ENABLE ROW LEVEL SECURITY;

-- Readable by whoever can read the line itself (checked under their own RLS).
DROP POLICY IF EXISTS "Read edits of readable lines" ON public.cash_transaction_edits;
CREATE POLICY "Read edits of readable lines"
  ON public.cash_transaction_edits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_transactions t WHERE t.id = transaction_id));

CREATE OR REPLACE FUNCTION public.record_cash_transaction_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  diff JSONB := '{}'::jsonb;
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    diff := diff || jsonb_build_object('amount', jsonb_build_object('from', OLD.amount, 'to', NEW.amount));
  END IF;
  IF NEW.direction IS DISTINCT FROM OLD.direction THEN
    diff := diff || jsonb_build_object('direction', jsonb_build_object('from', OLD.direction, 'to', NEW.direction));
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    diff := diff || jsonb_build_object('account_id', jsonb_build_object('from', OLD.account_id, 'to', NEW.account_id));
  END IF;
  IF NEW.txn_date IS DISTINCT FROM OLD.txn_date THEN
    diff := diff || jsonb_build_object('txn_date', jsonb_build_object('from', OLD.txn_date, 'to', NEW.txn_date));
  END IF;
  IF NEW.category IS DISTINCT FROM OLD.category THEN
    diff := diff || jsonb_build_object('category', jsonb_build_object('from', OLD.category, 'to', NEW.category));
  END IF;
  IF NEW.payee IS DISTINCT FROM OLD.payee THEN
    diff := diff || jsonb_build_object('payee', jsonb_build_object('from', OLD.payee, 'to', NEW.payee));
  END IF;
  IF NEW.reference IS DISTINCT FROM OLD.reference THEN
    diff := diff || jsonb_build_object('reference', jsonb_build_object('from', OLD.reference, 'to', NEW.reference));
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    diff := diff || jsonb_build_object('notes', jsonb_build_object('from', OLD.notes, 'to', NEW.notes));
  END IF;
  IF NEW.fx_rate IS DISTINCT FROM OLD.fx_rate THEN
    diff := diff || jsonb_build_object('fx_rate', jsonb_build_object('from', OLD.fx_rate, 'to', NEW.fx_rate));
  END IF;

  IF diff <> '{}'::jsonb THEN
    INSERT INTO public.cash_transaction_edits (transaction_id, edited_by_email, changes)
    VALUES (
      NEW.id,
      COALESCE(NEW.updated_by_email, (SELECT email FROM auth.users WHERE id = auth.uid())),
      diff
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_cash_transaction_edit ON public.cash_transactions;
CREATE TRIGGER trg_record_cash_transaction_edit
  AFTER UPDATE ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_cash_transaction_edit();
