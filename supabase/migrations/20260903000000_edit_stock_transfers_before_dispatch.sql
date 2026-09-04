-- Allow editing a stock transfer, but only before it has been dispatched.
--
-- Nothing moves stock until dispatch_stock_transfer runs, so a draft, a
-- transfer waiting for approval, and an approved one can all still be changed
-- freely. Once dispatched the stock has left the source branch, and rewriting
-- the lines would leave the ledger describing a shipment that never happened.
--
-- Enforced here as well as in the UI: a disabled button is not a permission,
-- and this one protects stock counts.
--
-- The workflow functions are SECURITY DEFINER and bypass RLS, so restricting
-- direct updates does not stop dispatch, receive or cancel.

CREATE OR REPLACE FUNCTION public.stock_transfer_is_editable(_transfer_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_transfers t
    WHERE t.id = _transfer_id
      AND t.status IN ('draft', 'pending_approval', 'approved')
  );
$$;

REVOKE ALL ON FUNCTION public.stock_transfer_is_editable(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_is_editable(UUID) TO authenticated;

-- Line items: readable at any status, writable only before dispatch.
DROP POLICY IF EXISTS "sti_all" ON public.stock_transfer_items;

CREATE POLICY "sti_select" ON public.stock_transfer_items FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  );

CREATE POLICY "sti_write" ON public.stock_transfer_items FOR ALL TO authenticated
  USING (
    public.stock_transfer_is_editable(transfer_id)
    AND EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  )
  WITH CHECK (
    public.stock_transfer_is_editable(transfer_id)
    AND EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  );
