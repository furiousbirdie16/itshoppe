-- Choosing which sheets of a price list to keep.
--
-- Each upload remembers the sheets it kept and the ones you unticked, so the
-- brand's next upload starts with the same choice and can flag sheets the
-- supplier has added since.
ALTER TABLE public.price_lists
  ADD COLUMN IF NOT EXISTS sheets TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skipped_sheets TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
