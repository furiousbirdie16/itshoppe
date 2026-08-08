-- Cost history is admin-only. Hiding the buttons is not enough — the table was
-- readable by any authenticated user, so the figures were one API call away.
--
-- Inserts are unaffected: the cost-history trigger runs on item updates and must
-- keep working for staff who edit items.
DROP POLICY IF EXISTS "Authenticated can view cost history" ON public.item_cost_history;
CREATE POLICY "Admins can view cost history"
  ON public.item_cost_history FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
