
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS supplier_sku TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_email TEXT;

ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE public.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('active','inactive','discontinued','archived'));

CREATE INDEX IF NOT EXISTS items_status_idx ON public.items(status);
CREATE INDEX IF NOT EXISTS items_category_idx ON public.items(category);
