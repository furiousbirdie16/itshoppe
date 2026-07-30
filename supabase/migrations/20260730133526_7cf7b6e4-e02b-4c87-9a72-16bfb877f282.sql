ALTER TABLE public.overseas_purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_status text NOT NULL DEFAULT 'not_shipped',
  ADD COLUMN IF NOT EXISTS shipped_at date;