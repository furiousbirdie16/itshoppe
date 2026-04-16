CREATE TABLE public.sales_agents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on sales_agents" ON public.sales_agents FOR ALL USING (true) WITH CHECK (true);