-- Which Everon payments each remittance covered.
--
-- An Everon payment row points at the remittance that sent it to Everon.
-- Deleting the remittance puts its payments back to "not remitted".
-- Not part of the edit history: only the fields people edit are recorded there.

ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS remitted_by uuid REFERENCES public.cash_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_transactions_remitted_by_idx
  ON public.cash_transactions (remitted_by) WHERE remitted_by IS NOT NULL;
