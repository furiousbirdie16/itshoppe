WITH targets AS (
  SELECT s.id, s.item_id, s.variation_id, s.quantity, s.posted_price, s.amount_paid, s.paid_at,
    COALESCE(
      NULLIF(iv.cost_price, 0),
      CASE WHEN s.variation_id IS NOT NULL AND COALESCE(iv.factor,0) > 0
           THEN NULLIF(i.cost_price,0) / iv.factor
           ELSE NULLIF(i.cost_price,0) END
    ) AS unit_cost
  FROM public.online_sales s
  LEFT JOIN public.online_sale_financials f ON f.online_sale_id = s.id
  LEFT JOIN public.item_variations iv ON iv.id = s.variation_id
  LEFT JOIN public.items i ON i.id = s.item_id
  WHERE s.payment_status = 'paid'
    AND (f.id IS NULL OR f.has_cost = false OR COALESCE(f.cost_snapshot, 0) = 0)
), calc AS (
  SELECT t.*,
    ROUND(t.unit_cost::numeric, 6) AS c,
    ROUND(t.unit_cost::numeric, 6) * COALESCE(t.quantity,0) AS line_cost
  FROM targets t WHERE t.unit_cost IS NOT NULL AND t.unit_cost > 0
)
INSERT INTO public.online_sale_financials
  (online_sale_id, item_id, variation_id, cost_snapshot, quantity, unit_price,
   amount_paid, line_total_cost, line_profit, gross_margin, is_paid, paid_at, has_cost)
SELECT c.id, c.item_id, c.variation_id, c.c, COALESCE(c.quantity,0), COALESCE(c.posted_price,0),
  COALESCE(c.amount_paid,0), c.line_cost,
  COALESCE(c.amount_paid,0) - c.line_cost,
  CASE WHEN COALESCE(c.amount_paid,0) > 0
       THEN ((COALESCE(c.amount_paid,0) - c.line_cost) / c.amount_paid) * 100 END,
  true, c.paid_at, true
FROM calc c
ON CONFLICT (online_sale_id) DO UPDATE SET
  cost_snapshot = EXCLUDED.cost_snapshot,
  quantity = EXCLUDED.quantity,
  unit_price = EXCLUDED.unit_price,
  amount_paid = EXCLUDED.amount_paid,
  line_total_cost = EXCLUDED.line_total_cost,
  line_profit = EXCLUDED.line_profit,
  gross_margin = EXCLUDED.gross_margin,
  is_paid = EXCLUDED.is_paid,
  paid_at = EXCLUDED.paid_at,
  has_cost = true,
  updated_at = now();