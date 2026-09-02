-- Record interest paid on a loan, and take it out of the account it was paid from.
--
-- Paying loan interest meant a bank outflow with a note, and nothing tying it to
-- the loan — so there was no way to see what a loan had actually cost.
--
-- Interest only, deliberately. Interest is a cost of borrowing and does not
-- reduce what is owed, so nothing here touches principal_amount; a payment that
-- pays the loan down is a different thing and is not modelled yet.

CREATE TABLE public.loan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- Which account it came out of. Null means "recorded but not paid from an
  -- account here", which posts nothing rather than guessing.
  cash_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loan_payments_loan ON public.loan_payments(loan_id, payment_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_payments TO authenticated;
GRANT ALL ON public.loan_payments TO service_role;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;

-- Same reach as loans themselves: admin only.
CREATE POLICY "Admins can view loan payments"
  ON public.loan_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can insert loan payments"
  ON public.loan_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update loan payments"
  ON public.loan_payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete loan payments"
  ON public.loan_payments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- The withdrawal a payment produced, so it can be moved or taken back when the
-- payment is edited or deleted.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS loan_payment_id UUID REFERENCES public.loan_payments(id) ON DELETE SET NULL;

-- One posting per payment: a repeat insert fails rather than quietly deducting
-- the interest twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_loan_payment
  ON public.cash_transactions(loan_payment_id) WHERE loan_payment_id IS NOT NULL;
