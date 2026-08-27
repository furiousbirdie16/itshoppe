-- Let staff undo an invoice payment they were already allowed to make.
--
-- Marking an invoice paid auto-posts an inflow, and the INSERT policy has long
-- allowed staff to do that for any account via `source_invoice_id IS NOT NULL`.
-- Removing it again was admin-only, which broke recalling an invoice: the
-- delete matched no rows for a staff user, and RLS filtering a DELETE is not an
-- error, so the app saw success while the money stayed in the old account under
-- the old customer's name. Re-marking it paid then hit the unique index on
-- source_invoice_id and posted nothing.
--
-- Only the app's own auto-posted rows are covered. A hand-entered bank
-- transaction has no source_invoice_id and stays admin-only, exactly as before.

DROP POLICY IF EXISTS "Update petty cash txns or admin updates any" ON public.cash_transactions;
CREATE POLICY "Update petty cash, invoice-posted, or admin any"
  ON public.cash_transactions FOR UPDATE TO authenticated
  USING (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can delete cash txns" ON public.cash_transactions;
DROP POLICY IF EXISTS "Delete petty cash, invoice-posted, or admin any" ON public.cash_transactions;
CREATE POLICY "Delete petty cash, invoice-posted, or admin any"
  ON public.cash_transactions FOR DELETE TO authenticated
  USING (
    public.is_petty_cash_account(account_id)
    OR source_invoice_id IS NOT NULL
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Staff still cannot see bank rows they did not post: the SELECT policy is
-- unchanged, so an invoice-posted bank entry is written and removed by the app
-- without the staff member being able to browse the account it landed in.
