-- Which items a non-item PO line is a cost of. A wooden pallet for the data
-- cabinets is not a cost of the patch panel on the same order.
-- { "<fee line id>": ["<item line id>", ...] }; a line not listed applies to all.
ALTER TABLE public.overseas_po_cargo
  ADD COLUMN IF NOT EXISTS fee_targets JSONB NOT NULL DEFAULT '{}'::jsonb;
