-- Landed costs from an overseas PO's cargo bill.
--
-- The cargo bill is entered on the PO once it arrives and split across the
-- lines by CBM (in the app — see src/lib/landed-cost.ts). An admin then
-- reviews the resulting costs and applies them; nothing changes an item's
-- cost without that, which is why receiving stopped doing it in August.
--
-- Everything here is admin-only: staff must not see what an item costs.

-- What an item takes up, remembered so the next shipment's CBM fills itself in;
-- and its most recent landed cost, shown quietly beside the averaged cost.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS cbm_per_unit NUMERIC,
  ADD COLUMN IF NOT EXISTS landed_cost_latest NUMERIC,
  ADD COLUMN IF NOT EXISTS landed_cost_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.overseas_po_cargo (
  po_id UUID PRIMARY KEY REFERENCES public.overseas_purchase_orders(id) ON DELETE CASCADE,
  cargo_amount NUMERIC NOT NULL DEFAULT 0,
  other_charges NUMERIC NOT NULL DEFAULT 0,
  -- { "<po line id>": cbm } for lines in boxes of their own.
  line_cbm JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "id", "label", "cbm", "lineIds": [...] }] for boxes holding several lines.
  boxes JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  applied_at TIMESTAMPTZ,
  applied_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT
);

ALTER TABLE public.overseas_po_cargo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage PO cargo" ON public.overseas_po_cargo;
CREATE POLICY "Admins manage PO cargo"
  ON public.overseas_po_cargo FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Apply reviewed costs in one go: each item's new (averaged) cost through the
-- same cost-history path as a manual change, plus its latest landed cost,
-- RMB cost and CBM per unit. All or nothing.
--
-- _rows: [{ "item_id", "new_cost", "landed_cost", "rmb_cost"?, "cbm_per_unit"? }]
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

  SELECT o.id, o.po_number, o.currency, o.exchange_rate, s.name AS supplier_name
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

    PERFORM public.record_item_cost_change(
      (r->>'item_id')::uuid,
      round((r->>'new_cost')::numeric, 4),
      'cargo_landed',
      po.id, po.po_number, po.supplier_name, po.currency, po.exchange_rate,
      'Landed cost from ' || po.po_number || ' (averaged with stock on hand)',
      uid, uemail
    );

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

REVOKE ALL ON FUNCTION public.apply_landed_costs(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_landed_costs(UUID, JSONB) TO authenticated;

-- The margin below which an admin is warned, as a percentage of the selling
-- price. Stored with the other business settings; 20% until changed.
INSERT INTO public.app_settings (key, value)
VALUES ('margin_target', '{"percent": 20}'::jsonb)
ON CONFLICT (key) DO NOTHING;
