-- The latest price each customer paid for each product.
--
-- The pricing page loaded 2000 history rows and worked it out in the browser,
-- which meant the answer to "what does John pay for siamese cable?" depended on
-- how recently he bought it. One row per customer and product, resolved in the
-- database, is both exact and small.
--
-- DISTINCT ON takes the first row of each group in the ORDER BY — here the most
-- recent sale, with created_at breaking ties on the same day.

CREATE OR REPLACE FUNCTION public.customer_last_prices()
RETURNS TABLE (
  customer_id UUID,
  item_id UUID,
  variation_id UUID,
  unit_price NUMERIC,
  sold_at TIMESTAMPTZ,
  reference_number TEXT,
  source TEXT,
  times_bought BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT h.customer_id, h.item_id, h.variation_id, count(*) AS times_bought
    FROM public.customer_price_history h
    GROUP BY h.customer_id, h.item_id, h.variation_id
  )
  SELECT DISTINCT ON (h.customer_id, h.item_id, h.variation_id)
    h.customer_id,
    h.item_id,
    h.variation_id,
    h.unit_price,
    h.sold_at,
    h.reference_number,
    h.source,
    c.times_bought
  FROM public.customer_price_history h
  JOIN counts c
    ON c.customer_id = h.customer_id
   AND c.item_id = h.item_id
   AND c.variation_id IS NOT DISTINCT FROM h.variation_id
  WHERE auth.uid() IS NOT NULL
  ORDER BY h.customer_id, h.item_id, h.variation_id, h.sold_at DESC, h.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.customer_last_prices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_last_prices() TO authenticated;

-- Every lookup is "this customer, this product", and the sort picks the newest.
CREATE INDEX IF NOT EXISTS idx_customer_price_history_lookup
  ON public.customer_price_history(customer_id, item_id, sold_at DESC);
