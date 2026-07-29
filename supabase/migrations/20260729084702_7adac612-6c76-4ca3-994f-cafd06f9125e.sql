
-- 1. Tables
CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text NOT NULL UNIQUE,
  source_branch_id uuid NOT NULL REFERENCES public.branches(id),
  destination_branch_id uuid NOT NULL REFERENCES public.branches(id),
  status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  requested_by uuid,
  requested_by_email text,
  requested_at timestamptz,
  approved_by uuid,
  approved_by_email text,
  approved_at timestamptz,
  dispatched_by uuid,
  dispatched_by_email text,
  dispatched_at timestamptz,
  received_by uuid,
  received_by_email text,
  received_at timestamptz,
  cancelled_by_email text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_branch_id <> destination_branch_id),
  CHECK (status IN ('draft','pending_approval','approved','in_transit','received','cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "st_select" ON public.stock_transfers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.user_has_branch(auth.uid(), source_branch_id)
    OR public.user_has_branch(auth.uid(), destination_branch_id)
  );
CREATE POLICY "st_insert" ON public.stock_transfers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.user_has_branch(auth.uid(), source_branch_id)
  );
CREATE POLICY "st_update" ON public.stock_transfers FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.user_has_branch(auth.uid(), source_branch_id)
    OR public.user_has_branch(auth.uid(), destination_branch_id)
  );
CREATE POLICY "st_delete" ON public.stock_transfers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER stock_transfers_updated_at BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id),
  variation_id uuid REFERENCES public.item_variations(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  source_location text NOT NULL DEFAULT 'warehouse' CHECK (source_location IN ('warehouse','store')),
  destination_location text NOT NULL DEFAULT 'warehouse' CHECK (destination_location IN ('warehouse','store')),
  received_quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_transfer_items(transfer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_items TO authenticated;
GRANT ALL ON public.stock_transfer_items TO service_role;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sti_all" ON public.stock_transfer_items FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
    ))
  );

CREATE TABLE public.stock_transfer_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid,
  actor_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_transfer_audit(transfer_id);

GRANT SELECT, INSERT ON public.stock_transfer_audit TO authenticated;
GRANT ALL ON public.stock_transfer_audit TO service_role;
ALTER TABLE public.stock_transfer_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sta_select" ON public.stock_transfer_audit FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  );
CREATE POLICY "sta_insert" ON public.stock_transfer_audit FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id AND (
      public.has_role(auth.uid(),'admin')
      OR public.user_has_branch(auth.uid(), t.source_branch_id)
      OR public.user_has_branch(auth.uid(), t.destination_branch_id)
    ))
  );

-- Document sequence
INSERT INTO public.document_sequences (id, prefix, next_number, padding)
VALUES ('STOCK_TRANSFER', 'TRF', 1, 4)
ON CONFLICT (id) DO NOTHING;

-- 2. Dispatch RPC
CREATE OR REPLACE FUNCTION public.dispatch_stock_transfer(_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  uemail text;
  t RECORD;
  li RECORD;
  qty_int integer;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO t FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status NOT IN ('approved','pending_approval','draft') THEN
    RAISE EXCEPTION 'Only draft/pending/approved transfers can be dispatched (current: %)', t.status;
  END IF;

  IF NOT public.has_role(uid,'admin') AND NOT public.user_has_branch(uid, t.source_branch_id) THEN
    RAISE EXCEPTION 'Not authorized to dispatch from this branch';
  END IF;

  FOR li IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = _transfer_id LOOP
    qty_int := li.quantity::integer;
    PERFORM * FROM public.apply_branch_stock_change(
      li.item_id, t.source_branch_id, li.source_location, (-qty_int)::numeric, 0::numeric, NULL
    );

    INSERT INTO public.inventory_movements(
      item_id, variation_id, type, quantity, reference_id, reference_type,
      notes, location, user_id, user_email, branch_id
    ) VALUES (
      li.item_id, li.variation_id, 'transfer_b2b_out', qty_int, _transfer_id, 'stock_transfer',
      'Dispatch ' || t.transfer_number, li.source_location, uid, uemail, t.source_branch_id
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit',
         dispatched_by = uid, dispatched_by_email = uemail, dispatched_at = now(),
         updated_at = now()
   WHERE id = _transfer_id;

  INSERT INTO public.stock_transfer_audit(transfer_id, action, from_status, to_status, actor_id, actor_email)
  VALUES (_transfer_id, 'dispatched', t.status, 'in_transit', uid, uemail);
END;
$$;

-- 3. Receive RPC (accepts jsonb array of {item_id, received_quantity})
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(_transfer_id uuid, _lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  uemail text;
  t RECORD;
  li RECORD;
  add_qty numeric;
  qty_int integer;
  all_done boolean;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO t FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Only in-transit transfers can be received (current: %)', t.status;
  END IF;

  IF NOT public.has_role(uid,'admin') AND NOT public.user_has_branch(uid, t.destination_branch_id) THEN
    RAISE EXCEPTION 'Not authorized to receive at this branch';
  END IF;

  FOR li IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = _transfer_id LOOP
    -- match by line id in _lines
    SELECT COALESCE((jsonb_path_query_first(_lines, ('$[*] ? (@.id == "' || li.id || '")')::jsonpath)->>'received_quantity')::numeric, 0)
      INTO add_qty;
    IF add_qty IS NULL OR add_qty <= 0 THEN CONTINUE; END IF;
    IF (li.received_quantity + add_qty) > li.quantity THEN
      RAISE EXCEPTION 'Received qty exceeds shipped qty for line %', li.id;
    END IF;

    qty_int := add_qty::integer;
    PERFORM * FROM public.apply_branch_stock_change(
      li.item_id, t.destination_branch_id, li.destination_location, qty_int::numeric, 0::numeric, NULL
    );

    INSERT INTO public.inventory_movements(
      item_id, variation_id, type, quantity, reference_id, reference_type,
      notes, location, user_id, user_email, branch_id
    ) VALUES (
      li.item_id, li.variation_id, 'transfer_b2b_in', qty_int, _transfer_id, 'stock_transfer',
      'Receive ' || t.transfer_number, li.destination_location, uid, uemail, t.destination_branch_id
    );

    UPDATE public.stock_transfer_items
       SET received_quantity = received_quantity + add_qty
     WHERE id = li.id;
  END LOOP;

  SELECT bool_and(received_quantity >= quantity) INTO all_done
    FROM public.stock_transfer_items WHERE transfer_id = _transfer_id;

  IF all_done THEN
    UPDATE public.stock_transfers
       SET status = 'received',
           received_by = uid, received_by_email = uemail, received_at = now(),
           updated_at = now()
     WHERE id = _transfer_id;

    INSERT INTO public.stock_transfer_audit(transfer_id, action, from_status, to_status, actor_id, actor_email)
    VALUES (_transfer_id, 'received', 'in_transit', 'received', uid, uemail);
  ELSE
    INSERT INTO public.stock_transfer_audit(transfer_id, action, from_status, to_status, actor_id, actor_email, notes)
    VALUES (_transfer_id, 'partial_receive', 'in_transit', 'in_transit', uid, uemail, 'Partial receipt');
  END IF;
END;
$$;

-- 4. Cancel RPC (reverses source deduction if already dispatched)
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(_transfer_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  uemail text;
  t RECORD;
  li RECORD;
  qty_int integer;
  remaining numeric;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO t FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF t.status IN ('received','cancelled') THEN
    RAISE EXCEPTION 'Transfer cannot be cancelled from status %', t.status;
  END IF;

  IF t.status = 'in_transit' AND NOT public.has_role(uid,'admin') THEN
    RAISE EXCEPTION 'Only admins can cancel a dispatched transfer';
  END IF;

  IF t.status = 'in_transit' THEN
    -- return remaining (shipped minus already received) to source
    FOR li IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = _transfer_id LOOP
      remaining := li.quantity - COALESCE(li.received_quantity,0);
      IF remaining > 0 THEN
        qty_int := remaining::integer;
        PERFORM * FROM public.apply_branch_stock_change(
          li.item_id, t.source_branch_id, li.source_location, qty_int::numeric, 0::numeric, NULL
        );
        INSERT INTO public.inventory_movements(
          item_id, variation_id, type, quantity, reference_id, reference_type,
          notes, location, user_id, user_email, branch_id
        ) VALUES (
          li.item_id, li.variation_id, 'transfer_b2b_in', qty_int, _transfer_id, 'stock_transfer_cancel',
          'Cancel ' || t.transfer_number || ' - return to source', li.source_location, uid, uemail, t.source_branch_id
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.stock_transfers
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_email = uemail,
         cancel_reason = COALESCE(_reason,''),
         updated_at = now()
   WHERE id = _transfer_id;

  INSERT INTO public.stock_transfer_audit(transfer_id, action, from_status, to_status, actor_id, actor_email, notes)
  VALUES (_transfer_id, 'cancelled', t.status, 'cancelled', uid, uemail, COALESCE(_reason,''));
END;
$$;

-- 5. Simple status transition RPC for submit/approve
CREATE OR REPLACE FUNCTION public.transition_stock_transfer(_transfer_id uuid, _to_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  uemail text;
  t RECORD;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO t FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF _to_status = 'pending_approval' AND t.status = 'draft' THEN
    UPDATE public.stock_transfers
       SET status = 'pending_approval',
           requested_by = COALESCE(requested_by, uid),
           requested_by_email = COALESCE(requested_by_email, uemail),
           requested_at = COALESCE(requested_at, now()),
           updated_at = now()
     WHERE id = _transfer_id;
  ELSIF _to_status = 'approved' AND t.status IN ('pending_approval','draft') THEN
    IF NOT public.has_role(uid,'admin') AND NOT public.user_has_branch(uid, t.source_branch_id) THEN
      RAISE EXCEPTION 'Not authorized to approve';
    END IF;
    UPDATE public.stock_transfers
       SET status = 'approved',
           approved_by = uid, approved_by_email = uemail, approved_at = now(),
           updated_at = now()
     WHERE id = _transfer_id;
  ELSE
    RAISE EXCEPTION 'Invalid transition % -> %', t.status, _to_status;
  END IF;

  INSERT INTO public.stock_transfer_audit(transfer_id, action, from_status, to_status, actor_id, actor_email)
  VALUES (_transfer_id, _to_status, t.status, _to_status, uid, uemail);
END;
$$;
