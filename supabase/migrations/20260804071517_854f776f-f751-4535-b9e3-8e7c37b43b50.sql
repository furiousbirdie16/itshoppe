-- Finance module: cash accounts (petty cash + banks), shared cash ledger,
-- owner transactions, and payables (post-dated checks + general bills).

CREATE TABLE public.cash_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'bank' CHECK (account_type IN ('petty_cash', 'bank')),
  account_number TEXT NOT NULL DEFAULT '',
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_accounts TO authenticated;
GRANT ALL ON public.cash_accounts TO service_role;

INSERT INTO public.cash_accounts (name, account_type, sort_order) VALUES
  ('Petty Cash', 'petty_cash', 0),
  ('BDO',        'bank',       1),
  ('Chinabank',  'bank',       2),
  ('BPI',        'bank',       3);

CREATE TABLE public.cash_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.cash_accounts(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('in', 'out')),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  category TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  transfer_group_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;
GRANT ALL ON public.cash_transactions TO service_role;

CREATE INDEX idx_cash_transactions_account_date
  ON public.cash_transactions (account_id, txn_date DESC);
CREATE INDEX idx_cash_transactions_transfer_group
  ON public.cash_transactions (transfer_group_id) WHERE transfer_group_id IS NOT NULL;

CREATE TABLE public.owner_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_type TEXT NOT NULL DEFAULT 'owner_paid' CHECK (txn_type IN ('owner_paid', 'company_repaid')),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'credit_card' CHECK (method IN ('credit_card', 'cash', 'bank_transfer', 'other')),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_transactions TO authenticated;
GRANT ALL ON public.owner_transactions TO service_role;

CREATE INDEX idx_owner_transactions_date ON public.owner_transactions (txn_date DESC);

CREATE TABLE public.payables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payee TEXT NOT NULL DEFAULT '',
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  amount_paid NUMERIC NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partial', 'paid', 'cleared', 'bounced', 'cancelled')),
  is_check BOOLEAN NOT NULL DEFAULT false,
  check_number TEXT NOT NULL DEFAULT '',
  check_bank TEXT NOT NULL DEFAULT '',
  date_written DATE,
  category TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables TO authenticated;
GRANT ALL ON public.payables TO service_role;

CREATE INDEX idx_payables_due_date ON public.payables (due_date);
CREATE INDEX idx_payables_status ON public.payables (status);

ALTER TABLE public.cash_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables           ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_petty_cash_account(_account_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_accounts
    WHERE id = _account_id AND account_type = 'petty_cash'
  );
$$;

CREATE POLICY "View petty cash accounts or admin sees all"
  ON public.cash_accounts FOR SELECT
  TO authenticated
  USING (account_type = 'petty_cash' OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage cash accounts"
  ON public.cash_accounts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "View petty cash txns or admin sees all"
  ON public.cash_transactions FOR SELECT
  TO authenticated
  USING (public.is_petty_cash_account(account_id) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Insert petty cash txns or admin inserts any"
  ON public.cash_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_petty_cash_account(account_id) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Update petty cash txns or admin updates any"
  ON public.cash_transactions FOR UPDATE
  TO authenticated
  USING (public.is_petty_cash_account(account_id) OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_petty_cash_account(account_id) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete cash txns"
  ON public.cash_transactions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage owner transactions"
  ON public.owner_transactions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage payables"
  ON public.payables FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_cash_accounts_updated_at
  BEFORE UPDATE ON public.cash_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cash_transactions_updated_at
  BEFORE UPDATE ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_owner_transactions_updated_at
  BEFORE UPDATE ON public.owner_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payables_updated_at
  BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();