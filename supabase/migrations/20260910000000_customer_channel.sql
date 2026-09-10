-- Where the conversation with a customer happens: Viber, Messenger, Shopee,
-- walk-in, and so on.
--
-- Free text rather than an enum. The list of places people message a shop from
-- changes faster than a schema does, and the form offers what has been typed
-- before, so the vocabulary settles on its own without locking it down.
--
-- Empty string rather than NULL, matching the other contact columns on this
-- table, so the form never has to distinguish "blank" from "not set".

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT '';

-- The customer list filters and groups by this, so it is worth an index once
-- there are enough customers for a scan to be noticeable.
CREATE INDEX IF NOT EXISTS idx_customers_channel
  ON public.customers(channel) WHERE channel <> '';
