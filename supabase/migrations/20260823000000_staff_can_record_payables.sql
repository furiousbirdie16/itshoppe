-- Let staff record and edit payables, but not settle them.
--
-- Payables were admin-only, so staff could not so much as see what was due.
-- Marking one Paid now posts a withdrawal against a cash or bank account, and
-- staff may only write petty cash transactions — a staff member settling a
-- bank-drawn payable would have that insert refused and leave the payable
-- marked paid with no money moved. So settling stays with admins.
--
-- Enforced here rather than only in the UI: a hidden button is not a permission.

-- Everyone signed in can read payables. Amounts and due dates are the point of
-- giving staff the page at all.
CREATE POLICY "Authenticated can view payables"
  ON public.payables FOR SELECT TO authenticated
  USING (true);

-- Staff may add a payable, as long as it does not arrive already settled.
CREATE POLICY "Staff can add unsettled payables"
  ON public.payables FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR status NOT IN ('paid', 'cleared')
  );

-- Staff may edit a payable that is not settled, and may not settle it. The
-- USING half stops them editing one an admin has already paid; the WITH CHECK
-- half stops them moving one into a settled state.
CREATE POLICY "Staff can edit unsettled payables"
  ON public.payables FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR status NOT IN ('paid', 'cleared')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR status NOT IN ('paid', 'cleared')
  );

-- Deletion is deliberately absent: deleting a settled payable also removes its
-- withdrawal from the ledger, which staff cannot do on a bank account. The
-- existing "Admins can manage payables" policy still covers admins for all four.
