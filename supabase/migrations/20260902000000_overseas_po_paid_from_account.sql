-- Pay an overseas PO from an account, and value it at what that currency cost.
--
-- Marking an overseas PO paid moved no money: the RMB left Alipay in reality but
-- the ledger never heard about it, so the balance drifted from the app. The PO's
-- exchange_rate was also typed in by hand, which meant the peso cost of a PO and
-- the peso cost of the RMB used to pay it were two unrelated numbers.

ALTER TABLE public.overseas_purchase_orders
  ADD COLUMN IF NOT EXISTS paid_from_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL;

-- The withdrawal a PO produced, so it can be moved or taken back when the PO is
-- edited or un-paid.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS overseas_po_id UUID REFERENCES public.overseas_purchase_orders(id) ON DELETE SET NULL;

-- One posting per PO: a repeat fails rather than quietly paying it twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_overseas_po
  ON public.cash_transactions(overseas_po_id) WHERE overseas_po_id IS NOT NULL;

-- Best-effort default for existing orders: the active account whose currency
-- matches the PO, but only when exactly one such account exists. Anything
-- ambiguous is left unset and simply posts nothing until someone picks.
UPDATE public.overseas_purchase_orders po
SET paid_from_account_id = a.id
FROM public.cash_accounts a
WHERE po.paid_from_account_id IS NULL
  AND a.is_active
  AND a.currency = po.currency
  AND (SELECT count(*) FROM public.cash_accounts a2
       WHERE a2.is_active AND a2.currency = po.currency) = 1;
