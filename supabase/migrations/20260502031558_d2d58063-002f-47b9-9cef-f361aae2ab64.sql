ALTER TABLE public.overseas_purchase_orders DROP CONSTRAINT IF EXISTS overseas_purchase_orders_status_check;

ALTER TABLE public.overseas_purchase_orders
  ADD CONSTRAINT overseas_purchase_orders_status_check
  CHECK (status IN ('unpaid','paid_not_shipped','shipped_not_paid','shipped','partially_received','received','draft','sent'));

UPDATE public.overseas_purchase_orders SET status = 'unpaid' WHERE status = 'draft';
UPDATE public.overseas_purchase_orders SET status = 'shipped' WHERE status = 'sent';