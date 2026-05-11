
-- Cost history table for inventory items
CREATE TABLE public.item_cost_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  previous_cost NUMERIC NOT NULL DEFAULT 0,
  new_cost NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  percentage_change NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'po_received', -- 'po_received' | 'overseas_po_received' | 'manual'
  po_id UUID,
  po_number TEXT,
  supplier_name TEXT,
  currency TEXT,
  exchange_rate NUMERIC,
  changed_by UUID,
  changed_by_email TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_cost_history_item ON public.item_cost_history(item_id, created_at DESC);
CREATE INDEX idx_item_cost_history_po ON public.item_cost_history(po_id);

ALTER TABLE public.item_cost_history ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated may read; updates and deletes are blocked entirely
-- to keep an immutable audit trail. Inserts happen via SECURITY DEFINER
-- triggers/functions only.
CREATE POLICY "Authenticated can view cost history"
  ON public.item_cost_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert cost history"
  ON public.item_cost_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No UPDATE policy and no DELETE policy => those operations are denied.

-- Helper: append a cost-history row and update items.cost_price atomically.
-- Used by both PO triggers and the manual override RPC.
CREATE OR REPLACE FUNCTION public.record_item_cost_change(
  _item_id UUID,
  _new_cost NUMERIC,
  _source TEXT,
  _po_id UUID,
  _po_number TEXT,
  _supplier_name TEXT,
  _currency TEXT,
  _exchange_rate NUMERIC,
  _reason TEXT,
  _changed_by UUID,
  _changed_by_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prev_cost NUMERIC;
  diff NUMERIC;
  pct NUMERIC;
  new_id UUID;
BEGIN
  IF _item_id IS NULL OR _new_cost IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cost_price INTO prev_cost FROM public.items WHERE id = _item_id;
  IF prev_cost IS NULL THEN prev_cost := 0; END IF;

  -- Skip if no real change (within 0.0001)
  IF ABS(COALESCE(prev_cost, 0) - _new_cost) < 0.0001 THEN
    RETURN NULL;
  END IF;

  diff := _new_cost - prev_cost;
  IF prev_cost = 0 THEN
    pct := 0;
  ELSE
    pct := (diff / prev_cost) * 100;
  END IF;

  INSERT INTO public.item_cost_history (
    item_id, previous_cost, new_cost, difference, percentage_change,
    source, po_id, po_number, supplier_name, currency, exchange_rate,
    changed_by, changed_by_email, reason
  ) VALUES (
    _item_id, prev_cost, _new_cost, diff, pct,
    _source, _po_id, _po_number, _supplier_name, _currency, _exchange_rate,
    _changed_by, _changed_by_email, COALESCE(_reason, '')
  )
  RETURNING id INTO new_id;

  UPDATE public.items
     SET cost_price = _new_cost,
         updated_at = now()
   WHERE id = _item_id;

  RETURN new_id;
END;
$$;

-- Trigger: when local PO line gets received (received_quantity increases),
-- update the item's cost_price to the unit_cost from this PO and log it.
CREATE OR REPLACE FUNCTION public.handle_po_item_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  po_rec RECORD;
  uid UUID;
  uemail TEXT;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.received_quantity, 0) <= COALESCE(OLD.received_quantity, 0) THEN
    RETURN NEW;
  END IF;

  SELECT po.po_number, s.name AS supplier_name
    INTO po_rec
    FROM public.purchase_orders po
    LEFT JOIN public.suppliers s ON s.id = po.supplier_id
   WHERE po.id = NEW.po_id;

  uid := auth.uid();
  IF uid IS NOT NULL THEN
    SELECT email INTO uemail FROM auth.users WHERE id = uid;
  END IF;

  PERFORM public.record_item_cost_change(
    NEW.item_id,
    NEW.unit_cost,
    'po_received',
    NEW.po_id,
    po_rec.po_number,
    po_rec.supplier_name,
    'PHP',
    1,
    'Auto-update from received PO',
    uid,
    uemail
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_item_cost_update
AFTER UPDATE OF received_quantity ON public.purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_po_item_received();

-- Trigger: same for overseas PO; convert unit cost to PHP using exchange_rate.
CREATE OR REPLACE FUNCTION public.handle_overseas_po_item_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  po_rec RECORD;
  uid UUID;
  uemail TEXT;
  landed NUMERIC;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.received_quantity, 0) <= COALESCE(OLD.received_quantity, 0) THEN
    RETURN NEW;
  END IF;

  SELECT po.po_number, po.currency, COALESCE(po.exchange_rate, 1) AS exchange_rate, s.name AS supplier_name
    INTO po_rec
    FROM public.overseas_purchase_orders po
    LEFT JOIN public.overseas_suppliers s ON s.id = po.supplier_id
   WHERE po.id = NEW.po_id;

  landed := COALESCE(NEW.unit_cost, 0) * COALESCE(po_rec.exchange_rate, 1);

  uid := auth.uid();
  IF uid IS NOT NULL THEN
    SELECT email INTO uemail FROM auth.users WHERE id = uid;
  END IF;

  PERFORM public.record_item_cost_change(
    NEW.item_id,
    landed,
    'overseas_po_received',
    NEW.po_id,
    po_rec.po_number,
    po_rec.supplier_name,
    po_rec.currency,
    po_rec.exchange_rate,
    'Auto-update from received import PO',
    uid,
    uemail
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_overseas_po_item_cost_update
AFTER UPDATE OF received_quantity ON public.overseas_purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_overseas_po_item_received();

-- Manual override RPC: lets admins set a new cost with a reason and audit info.
CREATE OR REPLACE FUNCTION public.set_item_cost_manual(
  _item_id UUID,
  _new_cost NUMERIC,
  _reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  uemail TEXT;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Admin role required to override cost';
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  RETURN public.record_item_cost_change(
    _item_id,
    _new_cost,
    'manual',
    NULL, NULL, NULL, 'PHP', 1,
    COALESCE(_reason, 'Manual cost override'),
    uid,
    uemail
  );
END;
$$;
