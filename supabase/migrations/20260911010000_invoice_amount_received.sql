-- What actually arrived when an invoice was paid, when that differs from its
-- total.
--
-- Staff sometimes quote a customer above the store price and keep the
-- difference: the invoice says 100, the customer pays 120 into the bank, and
-- the 20 is reimbursed to the staff member later. The ledger posted the
-- invoice total, so the bank read 20 short of the statement every time.
--
-- The invoice total stays the store's price — it is what sales, profit and the
-- customer's "last price paid" are built from. This column is only the cash.
-- NULL means the total was received, which is every invoice paid before this
-- existed.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC
    CHECK (amount_received IS NULL OR amount_received >= 0);
