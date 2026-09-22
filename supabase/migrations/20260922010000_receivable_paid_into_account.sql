-- Record which account a pending payment was collected into.
--
-- Marking one paid only flipped a status: the money never reached an account,
-- so a collected receivable was invisible in cash and bank. Staff also could
-- not name a bank, because they cannot read bank accounts at all.
--
-- Invoice payments already solve both halves — a names-only options function
-- for the dropdown, and an INSERT rule keyed on the source document so the app
-- can post into an account the staff member cannot browse. This extends the
-- same arrangement to manual receivables rather than inventing a second one.

ALTER TABLE public.manual_receivables
  ADD COLUMN IF NOT EXISTS paid_account_id UUID
    REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS source_manual_receivable_id UUID
    REFERENCES public.manual_receivables(id) ON DELETE SET NULL;

-- One posting per receivable, so a double-click cannot bank the money twice.
CREATE UNIQUE INDEX IF NOT EXISTS cash_transactions_source_manual_receivable_uniq
  ON public.cash_transactions(source_manual_receivable_id)
  WHERE source_manual_receivable_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The same three rules invoice postings get, widened to cover a receivable.
-- A hand-entered bank transaction still carries neither source column and
-- stays admin-only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Insert petty cash, invoice inflow, or admin any" ON public.cash_transactions;
CREATE POLICY "Insert petty cash, document inflow, or admin any"
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
    OR (
      source_manual_receivable_id IS NOT NULL
      AND direction = 'in'
      AND EXISTS (
        SELECT 1 FROM public.manual_receivables r
        WHERE r.id = source_manual_receivable_id
      )
    )
  );

DROP POLICY IF EXISTS "Update petty cash, invoice-posted, or admin any" ON public.cash_transactions;
CREATE POLICY "Update petty cash, document-posted, or admin any"
  ON public.cash_transactions FOR UPDATE TO authenticated
  USING (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR source_manual_receivable_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR source_manual_receivable_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Delete petty cash, invoice-posted, or admin any" ON public.cash_transactions;
CREATE POLICY "Delete petty cash, document-posted, or admin any"
  ON public.cash_transactions FOR DELETE TO authenticated
  USING (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR source_manual_receivable_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Staff still cannot browse the account the money landed in: the SELECT policy
-- is untouched, so a bank row they posted is written and removed by the app
-- without ever being listed to them.
