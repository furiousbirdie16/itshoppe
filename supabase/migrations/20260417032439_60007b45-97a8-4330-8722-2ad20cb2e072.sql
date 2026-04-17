ALTER TABLE public.items ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local';
ALTER TABLE public.items ADD CONSTRAINT items_source_check CHECK (source IN ('local','import'));