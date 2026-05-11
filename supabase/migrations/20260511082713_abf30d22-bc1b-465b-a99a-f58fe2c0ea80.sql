-- Add new statuses to po_status enum
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'pending_cargo_adjustment';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'cargo_adjusted';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'closed';

-- Cargo cost fields on PO
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cargo_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misc_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_additional_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cargo_adjusted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cargo_adjusted_by_email text,
  ADD COLUMN IF NOT EXISTS cargo_notes text NOT NULL DEFAULT '';

-- Per-line landed cost tracking
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS original_supplier_cost numeric,
  ADD COLUMN IF NOT EXISTS allocated_cargo_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_landed_cost numeric;
