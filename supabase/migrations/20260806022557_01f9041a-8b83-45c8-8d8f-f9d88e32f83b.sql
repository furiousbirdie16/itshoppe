DROP POLICY IF EXISTS "View petty cash accounts or admin sees all" ON public.cash_accounts;
CREATE POLICY "Authenticated can view cash accounts"
ON public.cash_accounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Insert petty cash txns or admin inserts any" ON public.cash_transactions;
CREATE POLICY "Insert petty cash, invoice-posted, or admin any"
ON public.cash_transactions FOR INSERT TO authenticated
WITH CHECK (
  public.is_petty_cash_account(account_id)
  OR source_invoice_id IS NOT NULL
  OR public.has_role(auth.uid(), 'admin'::app_role)
);