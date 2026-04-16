CREATE TYPE public.online_sale_status AS ENUM ('completed', 'returned', 'cancelled');

ALTER TABLE public.online_sales ADD COLUMN status public.online_sale_status NOT NULL DEFAULT 'completed';