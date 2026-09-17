-- When payment is due on an overseas PO.
--
-- Goods often ship before they are paid for, and the date the supplier expects
-- the money lived nowhere: expected_delivery is when the goods arrive, which is
-- a different promise. Without it a "shipped, not paid" order gives no hint that
-- it is overdue.
--
-- Nullable: most orders are paid up front and have no due date to record.

ALTER TABLE public.overseas_purchase_orders
  ADD COLUMN IF NOT EXISTS payment_due_date DATE;
