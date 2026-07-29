-- Backfill legacy rows without a branch to Manila
UPDATE public.inventory_movements
   SET branch_id = (SELECT id FROM public.branches WHERE branch_code = 'MNL' LIMIT 1)
 WHERE branch_id IS NULL;

-- Replace the permissive policy with a branch-scoped one
DROP POLICY IF EXISTS "Authenticated full access on inventory_movements" ON public.inventory_movements;

-- Admins & branch members can read
CREATE POLICY "Read inventory movements by branch"
  ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_has_branch(auth.uid(), branch_id)
  );

-- Writes require branch membership (or admin)
CREATE POLICY "Insert inventory movements by branch"
  ON public.inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.user_has_branch(auth.uid(), branch_id)
  );

CREATE POLICY "Update inventory movements by branch"
  ON public.inventory_movements
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_has_branch(auth.uid(), branch_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.user_has_branch(auth.uid(), branch_id)
  );

CREATE POLICY "Delete inventory movements by admin"
  ON public.inventory_movements
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
