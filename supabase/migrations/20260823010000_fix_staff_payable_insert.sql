-- Staff hit "new row violates row-level security policy for table payables"
-- when adding one.
--
-- Two things could cause that, and this fixes both. Either 20260823000000 was
-- never applied, in which case only the admin-only policy exists and every
-- staff insert is refused; or it was applied and the status test returned NULL
-- rather than true. `status NOT IN ('paid','cleared')` is NULL when status is
-- NULL, and a WITH CHECK that is not true is a refusal — so a payable arriving
-- without a status was rejected even though it was plainly unsettled.
--
-- Safe to run more than once, and safe to run whether or not the earlier
-- migration did.

DROP POLICY IF EXISTS "Authenticated can view payables" ON public.payables;
DROP POLICY IF EXISTS "Staff can add unsettled payables" ON public.payables;
DROP POLICY IF EXISTS "Staff can edit unsettled payables" ON public.payables;

CREATE POLICY "Authenticated can view payables"
  ON public.payables FOR SELECT TO authenticated
  USING (true);

-- COALESCE, so a missing status counts as unsettled instead of as NULL.
CREATE POLICY "Staff can add unsettled payables"
  ON public.payables FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR COALESCE(status, 'unpaid') NOT IN ('paid', 'cleared')
  );

CREATE POLICY "Staff can edit unsettled payables"
  ON public.payables FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR COALESCE(status, 'unpaid') NOT IN ('paid', 'cleared')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR COALESCE(status, 'unpaid') NOT IN ('paid', 'cleared')
  );

-- Deletion stays admin-only: it removes the payable's withdrawal from the
-- ledger too, which staff cannot do on a bank account.
