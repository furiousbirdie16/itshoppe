-- Why the money that arrived was not the money invoiced.
--
-- An invoice can already record that a different amount was received — a
-- customer rounds up, pays short, settles an old balance at the same time — but
-- not what the difference was for. The figure sat there unexplained, and by the
-- time anyone asked, nobody remembered.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_variance_note TEXT;

COMMENT ON COLUMN public.invoices.payment_variance_note IS
  'What the difference between amount_received and total_amount was for. Only meaningful when amount_received is set.';
