-- Lines on an overseas PO that are not stock are spread over the items as
-- charges (a delivery fee is a cost of getting the goods here). Some are not:
-- office supplies on the same order, a sample. These are the ones an admin
-- has said to leave out.
ALTER TABLE public.overseas_po_cargo
  ADD COLUMN IF NOT EXISTS excluded_lines JSONB NOT NULL DEFAULT '[]'::jsonb;
