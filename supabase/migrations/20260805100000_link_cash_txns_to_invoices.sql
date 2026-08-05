-- Link auto-posted ledger entries back to the invoice that created them, so the
-- posting is traceable, idempotent, and reversible when an invoice is reverted.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS source_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;

-- One ledger entry per invoice: a second mark-as-paid cannot double-post.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_transactions_source_invoice
  ON public.cash_transactions (source_invoice_id)
  WHERE source_invoice_id IS NOT NULL;
