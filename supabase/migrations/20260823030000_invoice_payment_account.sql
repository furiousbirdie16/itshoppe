-- Pin an invoice payment to the account it actually went into.
--
-- Which account an invoice paid into was worked out by matching the
-- payment_method label against cash account names, every time. Rename "GCash"
-- to "GCash Main" and the label on every past and future invoice matches
-- nothing, so the payment posts nowhere — silently, because an unmatched label
-- is indistinguishable from "this method has no account".
--
-- The account is now recorded when the invoice is marked paid. The label stays
-- for display and for older rows.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE SET NULL;

-- Prefer the account an existing posting actually landed in: that is what
-- happened, whatever the label says.
UPDATE public.invoices i
SET payment_account_id = t.account_id
FROM public.cash_transactions t
WHERE t.source_invoice_id = i.id
  AND i.payment_account_id IS NULL
  AND t.account_id IS NOT NULL;

-- For the rest, fall back to the label, and only when it names exactly one
-- account — an ambiguous name is left unset rather than guessed at.
UPDATE public.invoices i
SET payment_account_id = a.id
FROM public.cash_accounts a
WHERE i.payment_account_id IS NULL
  AND i.payment_method IS NOT NULL
  AND lower(btrim(a.name)) = lower(btrim(i.payment_method))
  AND (SELECT count(*) FROM public.cash_accounts a2
       WHERE lower(btrim(a2.name)) = lower(btrim(i.payment_method))) = 1;
