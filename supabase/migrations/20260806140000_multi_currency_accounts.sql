-- Multi-currency support: an account holds one currency, and every inflow into a
-- non-PHP account records the PHP rate paid. Balances in PHP are derived from a
-- running weighted average of those rates (see src/lib/fx.ts), so no stored
-- average can drift out of step with the transactions.
ALTER TABLE public.cash_accounts
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'PHP';

-- PHP paid per one unit of the account's currency. Only meaningful on inflows
-- into a non-PHP account; NULL everywhere else.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;

ALTER TABLE public.cash_transactions
  DROP CONSTRAINT IF EXISTS cash_transactions_fx_rate_positive;
ALTER TABLE public.cash_transactions
  ADD CONSTRAINT cash_transactions_fx_rate_positive
  CHECK (fx_rate IS NULL OR fx_rate > 0);
