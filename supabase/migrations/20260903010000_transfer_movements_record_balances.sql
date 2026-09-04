-- Record the balance either side of a branch transfer.
--
-- inventory_movements has balance_before and balance_after, and the rest of the
-- app fills them in. The transfer functions never did, so a dispatch left both
-- null and the item history had to infer them by walking backwards from the
-- current stock — which cannot show what a single movement took out.
--
-- apply_branch_stock_change already returns both sides; they were simply
-- discarded. The location decides which pair matters: a warehouse line moves
-- warehouse_quantity, a store line moves store_quantity.

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
  bal RECORD;
  before_qty integer;
  after_qty integer;
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

    SELECT * INTO bal FROM public.apply_branch_stock_change(
      li.item_id, t.source_branch_id, li.source_location, (-qty_int)::numeric, 0::numeric, NULL
    );

    IF li.source_location = 'store' THEN
      before_qty := bal.st_before;
      after_qty  := bal.store_quantity;
    ELSE
      before_qty := bal.wh_before;
      after_qty  := bal.warehouse_quantity;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, variation_id, type, quantity, reference_id, reference_type,
      notes, location, user_id, user_email, branch_id,
      balance_before, balance_after
    ) VALUES (
      li.item_id, li.variation_id, 'transfer_b2b_out', qty_int, _transfer_id, 'stock_transfer',
      'Dispatch ' || t.transfer_number, li.source_location, uid, uemail, t.source_branch_id,
      before_qty, after_qty
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
  bal RECORD;
  before_qty integer;
  after_qty integer;
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
    SELECT COALESCE((jsonb_path_query_first(_lines, ('$[*] ? (@.id == "' || li.id || '")')::jsonpath)->>'received_quantity')::numeric, 0)
      INTO add_qty;
    IF add_qty IS NULL OR add_qty <= 0 THEN CONTINUE; END IF;
    IF (li.received_quantity + add_qty) > li.quantity THEN
      RAISE EXCEPTION 'Received qty exceeds shipped qty for line %', li.id;
    END IF;

    qty_int := add_qty::integer;

    SELECT * INTO bal FROM public.apply_branch_stock_change(
      li.item_id, t.destination_branch_id, li.destination_location, qty_int::numeric, 0::numeric, NULL
    );

    IF li.destination_location = 'store' THEN
      before_qty := bal.st_before;
      after_qty  := bal.store_quantity;
    ELSE
      before_qty := bal.wh_before;
      after_qty  := bal.warehouse_quantity;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, variation_id, type, quantity, reference_id, reference_type,
      notes, location, user_id, user_email, branch_id,
      balance_before, balance_after
    ) VALUES (
      li.item_id, li.variation_id, 'transfer_b2b_in', qty_int, _transfer_id, 'stock_transfer',
      'Receive ' || t.transfer_number, li.destination_location, uid, uemail, t.destination_branch_id,
      before_qty, after_qty
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
