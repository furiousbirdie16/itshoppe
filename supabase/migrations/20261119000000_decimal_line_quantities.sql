-- Quotation and invoice lines can hold decimal quantities (2.5 m, 1.5 hours).
-- Up to 3 decimal places. Whole numbers stay as they are.
-- Lines linked to stocked pieces are still kept whole by the app, because
-- stock is counted in whole pieces.

ALTER TABLE public.invoice_items
  ALTER COLUMN quantity TYPE numeric(12,3) USING quantity::numeric(12,3);

ALTER TABLE public.quotation_items
  ALTER COLUMN quantity TYPE numeric(12,3) USING quantity::numeric(12,3);
