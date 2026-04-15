-- Add quantity column to online_sales
ALTER TABLE public.online_sales ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- Add 'others' to sales_channel enum
ALTER TYPE public.sales_channel ADD VALUE IF NOT EXISTS 'others';