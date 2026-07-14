ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS customers_tags_gin_idx ON public.customers USING gin (tags);