-- Cost details shown under a product in Inventory.
--
--   qty_per_box          how many pieces come in one box, set by us, for reordering by the carton
--   rmb_rate             pesos per RMB on the last overseas shipment
--   cargo_cost_per_unit  pesos of cargo and charges per piece on the last shipment
--
-- Applying a shipment's cargo costs now fills the rate and cargo cost, the way
-- it already fills the RMB cost and CBM. Admins can also type them in.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS qty_per_box INTEGER,
  ADD COLUMN IF NOT EXISTS rmb_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS cargo_cost_per_unit NUMERIC;

-- What earlier shipments already tell us: the rate from each item's latest
-- applied RMB shipment, and cargo = landed cost less the goods at that rate.
WITH last_rmb AS (
  SELECT DISTINCT ON (h.item_id) h.item_id, h.exchange_rate
    FROM public.item_cost_history h
   WHERE h.source = 'cargo_landed' AND upper(h.currency) = 'RMB' AND h.exchange_rate > 0
   ORDER BY h.item_id, h.created_at DESC
)
UPDATE public.items i
   SET rmb_rate = coalesce(i.rmb_rate, l.exchange_rate),
       cargo_cost_per_unit = coalesce(
         i.cargo_cost_per_unit,
         CASE WHEN i.landed_cost_latest IS NOT NULL AND coalesce(i.cost_price_rmb, 0) > 0
              THEN greatest(round(i.landed_cost_latest - i.cost_price_rmb * l.exchange_rate, 4), 0)
         END)
  FROM last_rmb l
 WHERE l.item_id = i.id;

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
      rmb_rate           = CASE WHEN upper(po.currency) = 'RMB' AND po.exchange_rate > 0 THEN po.exchange_rate ELSE rmb_rate END,
      cargo_cost_per_unit = COALESCE(round((r->>'cargo_per_unit')::numeric, 4), cargo_cost_per_unit),
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
