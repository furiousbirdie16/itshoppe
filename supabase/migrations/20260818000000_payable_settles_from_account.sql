-- Let a payable name the account it is settled from, so marking it Paid moves
-- the money out of that bank or cash account instead of leaving the balance
-- untouched.
--
-- payables.check_bank is free text ("CHINABANK") with nothing tying it to a
-- cash_accounts row, so the app could never know which balance to reduce. The
-- text column stays for the check face itself; the link is what is new.

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL;

-- The transaction a payable posted, so the app can tell whether it has already
-- been settled and can take the money back if the payable is un-paid, bounces,
-- or is deleted.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS payable_id UUID REFERENCES public.payables(id) ON DELETE SET NULL;

-- One posting per payable. This is the guard against a double deduction: a
-- second insert for the same payable fails rather than quietly halving the
-- balance, whatever order the client happens to fire updates in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_payable
  ON public.cash_transactions(payable_id) WHERE payable_id IS NOT NULL;

-- Best-effort link for payables already written against a named bank. Matches
-- on name, case- and space-insensitively; anything with no clear match is left
-- unset and simply posts nothing until someone picks an account by hand.
UPDATE public.payables p
SET cash_account_id = a.id
FROM public.cash_accounts a
WHERE p.cash_account_id IS NULL
  AND p.check_bank IS NOT NULL
  AND btrim(p.check_bank) <> ''
  AND lower(btrim(a.name)) = lower(btrim(p.check_bank))
  -- Only when the name is unambiguous, so a duplicate never picks the wrong one.
  AND (SELECT count(*) FROM public.cash_accounts a2
       WHERE lower(btrim(a2.name)) = lower(btrim(p.check_bank))) = 1;
