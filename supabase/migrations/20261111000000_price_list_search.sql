-- Price list search the way customers ask ("8ch DVR", "2mp indoor analog").
--
-- Each model gets a search text made when its list is uploaded: model, sheet
-- name and description with spellings made the same, plus words read from
-- the model number (DS-2CE → analog camera, DS-72xxH → DVR). Lists uploaded
-- before this have an empty search text and are found only after they are
-- uploaded again.
ALTER TABLE public.price_list_items
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
