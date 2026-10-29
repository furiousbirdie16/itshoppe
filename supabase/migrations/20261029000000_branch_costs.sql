-- Cost per branch.
--
-- Manila and Gensan are one company with one product list, but each branch's
-- stock is bought at its own prices and shipped at its own cargo cost, so each
-- now carries its own cost: item_branch_stock.cost_price. A sale is costed at
-- its branch's figure, a shipment's landed cost goes to the branch it was
-- received at, and a transfer brings the sending branch's cost across.
--
-- items.cost_price stays as the company figure: every branch starts from it,
-- a company-wide edit (the item form on "All branches", a bulk edit) still
-- sets it and so every branch, and a branch-only change re-blends it from the
-- branches by stock held.

-- 1. The column, every branch starting at today's cost --------------------------
ALTER TABLE public.item_branch_stock ADD COLUMN IF NOT EXISTS cost_price NUMERIC;

UPDATE public.item_branch_stock bs
   SET cost_price = i.cost_price
  FROM public.items i
 WHERE i.id = bs.item_id AND bs.cost_price IS NULL;

ALTER TABLE public.item_cost_history ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- A branch's first stock of an item starts at the company cost.
CREATE OR REPLACE FUNCTION public.branch_stock_default_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cost_price IS NULL THEN
    SELECT cost_price INTO NEW.cost_price FROM public.items WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_branch_stock_default_cost ON public.item_branch_stock;
CREATE TRIGGER trg_branch_stock_default_cost
  BEFORE INSERT ON public.item_branch_stock
  FOR EACH ROW EXECUTE FUNCTION public.branch_stock_default_cost();

-- 2. Reading a cost at a branch ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.item_cost_at(_item_id UUID, _branch_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT bs.cost_price FROM public.item_branch_stock bs WHERE bs.item_id = _item_id AND bs.branch_id = _branch_id),
    (SELECT i.cost_price FROM public.items i WHERE i.id = _item_id)
  );
$$;

-- A variation's cost at a branch: its own if set by hand, else its share of
-- the parent's cost at that branch.
CREATE OR REPLACE FUNCTION public.variation_cost_at(_variation_id UUID, _branch_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN v.cost_is_manual THEN v.cost_price
    ELSE public.compute_variation_cost(public.item_cost_at(v.item_id, _branch_id), i.units_per_stock, v.factor)
  END
  FROM public.item_variations v
  JOIN public.items i ON i.id = v.item_id
  WHERE v.id = _variation_id;
$$;

REVOKE ALL ON FUNCTION public.item_cost_at(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_cost_at(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.variation_cost_at(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.variation_cost_at(UUID, UUID) TO authenticated;

-- 3. Keeping the company figure and the branches in step ---------------------------
-- A change made to items.cost_price directly is company-wide: it sets every
-- branch. A branch-only change re-blends the company figure, and marks itself
-- so this does not push the blend back down onto the branches.
CREATE OR REPLACE FUNCTION public.items_cost_to_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price
     AND COALESCE(current_setting('app.branch_cost_blend', true), '') <> 'on' THEN
    UPDATE public.item_branch_stock SET cost_price = NEW.cost_price WHERE item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_items_cost_to_branches ON public.items;
CREATE TRIGGER trg_items_cost_to_branches
  AFTER UPDATE OF cost_price ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.items_cost_to_branches();

CREATE OR REPLACE FUNCTION public.refresh_item_blended_cost(_item_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blend NUMERIC;
BEGIN
  SELECT CASE
           WHEN SUM(GREATEST(quantity, 0)) > 0
             THEN SUM(GREATEST(quantity, 0) * cost_price) / SUM(GREATEST(quantity, 0))
           ELSE AVG(cost_price)
         END
    INTO v_blend
    FROM public.item_branch_stock
   WHERE item_id = _item_id AND cost_price IS NOT NULL;
  IF v_blend IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.branch_cost_blend', 'on', true);
  UPDATE public.items SET cost_price = round(v_blend, 2), updated_at = now() WHERE id = _item_id;
  PERFORM set_config('app.branch_cost_blend', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_item_blended_cost(UUID) FROM PUBLIC, anon, authenticated;

-- One branch's cost changes, with a cost-history row naming the branch.
CREATE OR REPLACE FUNCTION public.record_branch_cost_change(
  _item_id UUID, _branch_id UUID, _new_cost NUMERIC, _source TEXT,
  _po_id UUID, _po_number TEXT, _supplier_name TEXT, _currency TEXT, _exchange_rate NUMERIC,
  _reason TEXT, _changed_by UUID, _changed_by_email TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prev_cost NUMERIC;
  new_id UUID;
BEGIN
  IF _item_id IS NULL OR _branch_id IS NULL OR _new_cost IS NULL THEN RETURN NULL; END IF;
  prev_cost := COALESCE(public.item_cost_at(_item_id, _branch_id), 0);
  IF ABS(prev_cost - _new_cost) < 0.0001 THEN RETURN NULL; END IF;

  INSERT INTO public.item_cost_history (
    item_id, branch_id, previous_cost, new_cost, difference, percentage_change,
    source, po_id, po_number, supplier_name, currency, exchange_rate,
    changed_by, changed_by_email, reason
  ) VALUES (
    _item_id, _branch_id, prev_cost, _new_cost, _new_cost - prev_cost,
    CASE WHEN prev_cost = 0 THEN 0 ELSE ((_new_cost - prev_cost) / prev_cost) * 100 END,
    _source, _po_id, _po_number, _supplier_name, _currency, _exchange_rate,
    _changed_by, _changed_by_email, COALESCE(_reason, '')
  ) RETURNING id INTO new_id;

  INSERT INTO public.item_branch_stock (item_id, branch_id, cost_price)
  VALUES (_item_id, _branch_id, _new_cost)
  ON CONFLICT (item_id, branch_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_at = now();

  PERFORM public.refresh_item_blended_cost(_item_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_branch_cost_change(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Setting a cost by hand: one branch, or (no branch) every branch. Admins
-- always; staff for local items, as the item form allows.
CREATE OR REPLACE FUNCTION public.set_item_cost(_item_id UUID, _new_cost NUMERIC, _reason TEXT, _branch_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  uemail TEXT;
  v_source TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE(source, 'local') INTO v_source FROM public.items WHERE id = _item_id;
  IF NOT public.has_role(uid, 'admin') AND v_source <> 'local' THEN
    RAISE EXCEPTION 'Only an admin can change the cost of an imported item';
  END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  IF _branch_id IS NULL THEN
    RETURN public.record_item_cost_change(_item_id, _new_cost, 'manual', NULL, NULL, NULL, 'PHP', 1,
      COALESCE(_reason, 'Manual cost change'), uid, uemail);
  END IF;
  RETURN public.record_branch_cost_change(_item_id, _branch_id, _new_cost, 'manual', NULL, NULL, NULL, 'PHP', 1,
    COALESCE(_reason, 'Manual cost change'), uid, uemail);
END;
$$;
REVOKE ALL ON FUNCTION public.set_item_cost(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_cost(UUID, NUMERIC, TEXT, UUID) TO authenticated;

-- 4. Transfers bring the sending branch's cost ------------------------------------
-- When stock arrives from another branch, the receiving branch's cost becomes
-- the average of what it held and what came in, at the sender's cost.
CREATE OR REPLACE FUNCTION public.blend_cost_on_transfer_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source UUID;
  v_src_cost NUMERIC;
  v_dest_cost NUMERIC;
  v_held NUMERIC;
  v_new NUMERIC;
BEGIN
  IF NEW.type::text <> 'transfer_b2b_in' OR NEW.reference_type <> 'stock_transfer' OR NEW.item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT source_branch_id INTO v_source FROM public.stock_transfers WHERE id = NEW.reference_id;
  IF v_source IS NULL OR NEW.branch_id IS NULL THEN RETURN NEW; END IF;

  v_src_cost := public.item_cost_at(NEW.item_id, v_source);
  v_dest_cost := public.item_cost_at(NEW.item_id, NEW.branch_id);
  IF v_src_cost IS NULL OR v_dest_cost IS NULL OR ABS(v_src_cost - v_dest_cost) < 0.0001 THEN RETURN NEW; END IF;

  -- Already includes what just arrived.
  SELECT GREATEST(quantity - NEW.quantity, 0) INTO v_held
    FROM public.item_branch_stock WHERE item_id = NEW.item_id AND branch_id = NEW.branch_id;
  v_held := COALESCE(v_held, 0);
  v_new := (v_held * v_dest_cost + NEW.quantity * v_src_cost) / NULLIF(v_held + NEW.quantity, 0);
  IF v_new IS NULL THEN RETURN NEW; END IF;

  PERFORM public.record_branch_cost_change(
    NEW.item_id, NEW.branch_id, round(v_new, 4), 'transfer', NULL, NULL, NULL, 'PHP', 1,
    'Transfer in, averaged with stock held', NEW.user_id, NEW.user_email);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_blend_cost_on_transfer_in ON public.inventory_movements;
CREATE TRIGGER trg_blend_cost_on_transfer_in
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.blend_cost_on_transfer_in();

-- 5. Landed costs go to the branch the shipment was for ----------------------------
CREATE OR REPLACE FUNCTION public.apply_landed_costs(_po_id UUID, _rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  uemail TEXT;
  po RECORD;
  r JSONB;
  n INT := 0;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to apply landed costs';
  END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT o.id, o.po_number, o.currency, o.exchange_rate, o.branch_id, s.name AS supplier_name
    INTO po
    FROM public.overseas_purchase_orders o
    LEFT JOIN public.overseas_suppliers s ON s.id = o.supplier_id
   WHERE o.id = _po_id;
  IF po.id IS NULL THEN
    RAISE EXCEPTION 'Overseas PO not found';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) LOOP
    IF (r->>'item_id') IS NULL OR (r->>'new_cost') IS NULL THEN
      CONTINUE;
    END IF;

    IF po.branch_id IS NOT NULL THEN
      PERFORM public.record_branch_cost_change(
        (r->>'item_id')::uuid, po.branch_id,
        round((r->>'new_cost')::numeric, 4),
        'cargo_landed',
        po.id, po.po_number, po.supplier_name, po.currency, po.exchange_rate,
        'Landed cost from ' || po.po_number || ' (averaged with stock on hand)',
        uid, uemail
      );
    ELSE
      PERFORM public.record_item_cost_change(
        (r->>'item_id')::uuid,
        round((r->>'new_cost')::numeric, 4),
        'cargo_landed',
        po.id, po.po_number, po.supplier_name, po.currency, po.exchange_rate,
        'Landed cost from ' || po.po_number || ' (averaged with stock on hand)',
        uid, uemail
      );
    END IF;

    UPDATE public.items SET
      landed_cost_latest = COALESCE(round((r->>'landed_cost')::numeric, 4), landed_cost_latest),
      landed_cost_at     = now(),
      cost_price_rmb     = COALESCE((r->>'rmb_cost')::numeric, cost_price_rmb),
      cbm_per_unit       = COALESCE((r->>'cbm_per_unit')::numeric, cbm_per_unit),
      updated_at         = now()
     WHERE id = (r->>'item_id')::uuid;

    n := n + 1;
  END LOOP;

  UPDATE public.overseas_po_cargo
     SET applied_at = now(), applied_by_email = uemail
   WHERE po_id = _po_id;

  RETURN n;
END;
$$;

-- 6. Sales costed at their branch ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch UUID;
  v_cost NUMERIC;               -- NULL means "cost not set"
  v_line_cost NUMERIC;
  v_line_profit NUMERIC;
BEGIN
  IF NEW.item_id IS NULL THEN
    -- A line typed by hand takes back the cost last set for that description
    -- on this invoice, so editing the invoice does not lose it.
    SELECT c.cost INTO v_cost
    FROM public.invoice_manual_line_costs c
    WHERE c.invoice_id = NEW.invoice_id
      AND c.item_name_key = public.manual_line_key(NEW.item_name);

    IF v_cost IS NOT NULL THEN
      v_line_cost := v_cost * COALESCE(NEW.quantity, 0);
      v_line_profit := (COALESCE(NEW.unit_price, 0) - v_cost) * COALESCE(NEW.quantity, 0);
    END IF;

    INSERT INTO public.invoice_item_financials
      (invoice_id, item_id, variation_id, invoice_item_id, cost_snapshot,
       quantity, unit_price, line_total_cost, line_profit)
    VALUES
      (NEW.invoice_id, NULL, NEW.variation_id, NEW.id, v_cost,
       COALESCE(NEW.quantity, 0), COALESCE(NEW.unit_price, 0), v_line_cost, v_line_profit)
    ON CONFLICT (invoice_item_id) WHERE invoice_item_id IS NOT NULL
    DO UPDATE SET
      cost_snapshot = COALESCE(invoice_item_financials.cost_snapshot, EXCLUDED.cost_snapshot),
      quantity = EXCLUDED.quantity,
      unit_price = EXCLUDED.unit_price,
      line_total_cost = CASE WHEN COALESCE(invoice_item_financials.cost_snapshot, EXCLUDED.cost_snapshot) IS NULL THEN NULL
                             ELSE COALESCE(invoice_item_financials.cost_snapshot, EXCLUDED.cost_snapshot) * EXCLUDED.quantity END,
      line_profit = CASE WHEN COALESCE(invoice_item_financials.cost_snapshot, EXCLUDED.cost_snapshot) IS NULL THEN NULL
                         ELSE (EXCLUDED.unit_price - COALESCE(invoice_item_financials.cost_snapshot, EXCLUDED.cost_snapshot)) * EXCLUDED.quantity END,
      updated_at = now();
    RETURN NEW;
  END IF;

  -- The cost at the invoice's own branch: a Gensan sale is costed at what
  -- Gensan's stock cost, not Manila's.
  SELECT branch_id INTO v_branch FROM public.invoices WHERE id = NEW.invoice_id;
  IF NEW.variation_id IS NOT NULL THEN
    -- Variation sale: use ONLY the variation's own cost. Do not fall back to parent.
    v_cost := public.variation_cost_at(NEW.variation_id, v_branch);
  ELSE
    v_cost := public.item_cost_at(NEW.item_id, v_branch);
  END IF;

  IF v_cost IS NULL THEN
    v_line_cost := NULL;
    v_line_profit := NULL;
  ELSE
    v_line_cost := v_cost * COALESCE(NEW.quantity, 0);
    v_line_profit := (COALESCE(NEW.unit_price, 0) - v_cost) * COALESCE(NEW.quantity, 0);
  END IF;

  INSERT INTO public.invoice_item_financials
    (invoice_id, item_id, variation_id, invoice_item_id, cost_snapshot, quantity, unit_price, line_total_cost, line_profit)
  VALUES
    (NEW.invoice_id, NEW.item_id, NEW.variation_id, NEW.id, v_cost,
     COALESCE(NEW.quantity, 0), COALESCE(NEW.unit_price, 0),
     v_line_cost, v_line_profit)
  ON CONFLICT (invoice_id, item_id, COALESCE(variation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    invoice_item_id = EXCLUDED.invoice_item_id,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    line_total_cost = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                           ELSE invoice_item_financials.cost_snapshot * EXCLUDED.quantity END,
    line_profit = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                       ELSE (EXCLUDED.unit_price - invoice_item_financials.cost_snapshot) * EXCLUDED.quantity END,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_online_sale_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost NUMERIC;
  v_qty  NUMERIC := COALESCE(NEW.quantity, 0);
  v_unit NUMERIC := COALESCE(NEW.posted_price, 0);
  v_paid NUMERIC := COALESCE(NEW.amount_paid, 0);
  v_is_paid BOOLEAN := (NEW.payment_status = 'paid');
  v_line_cost NUMERIC;
  v_line_profit NUMERIC;
  v_margin NUMERIC;
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    -- The cost at the sale's own branch.
    IF NEW.variation_id IS NOT NULL THEN
      v_cost := public.variation_cost_at(NEW.variation_id, NEW.branch_id);
    ELSE
      v_cost := public.item_cost_at(NEW.item_id, NEW.branch_id);
    END IF;
  END IF;

  IF v_cost IS NULL THEN
    v_line_cost := NULL;
    v_line_profit := NULL;
    v_margin := NULL;
  ELSE
    v_line_cost := v_cost * v_qty;
    IF v_is_paid THEN
      v_line_profit := v_paid - v_line_cost;
      IF v_paid > 0 THEN v_margin := (v_line_profit / v_paid) * 100; ELSE v_margin := NULL; END IF;
    END IF;
  END IF;

  INSERT INTO public.online_sale_financials
    (online_sale_id, item_id, variation_id, cost_snapshot, quantity, unit_price,
     amount_paid, line_total_cost, line_profit, gross_margin, is_paid, paid_at, has_cost)
  VALUES
    (NEW.id, NEW.item_id, NEW.variation_id, v_cost, v_qty, v_unit,
     v_paid, v_line_cost, v_line_profit, v_margin, v_is_paid, NEW.paid_at, v_cost IS NOT NULL)
  ON CONFLICT (online_sale_id) DO NOTHING; -- cost is locked; don't overwrite on re-insert
  RETURN NEW;
END;
$$;

-- 7. Reserved stock at branch cost --------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserved_stock_value(p_branch_id UUID DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(ii.quantity * public.item_cost_at(ii.item_id, inv.branch_id)), 0)
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
  WHERE ii.item_id IS NOT NULL
    AND inv.status::text = 'reserved'
    AND (p_branch_id IS NULL OR inv.branch_id = p_branch_id);
$$;

-- generate_asset_snapshot is left as it is: it values stock at items.cost_price,
-- which this keeps as the branches blended by stock held.
