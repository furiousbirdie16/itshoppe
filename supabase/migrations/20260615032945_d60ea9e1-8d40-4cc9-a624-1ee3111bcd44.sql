
-- Add new invoice statuses for the Reserved-order workflow
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'reserved';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'shipped';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Track shipment + cancellation timestamps so reports can distinguish them
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
