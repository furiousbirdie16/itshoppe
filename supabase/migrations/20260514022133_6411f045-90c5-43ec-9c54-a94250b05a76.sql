
ALTER TABLE public.overseas_purchase_orders
  ADD COLUMN IF NOT EXISTS cargo_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misc_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_additional_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cargo_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cargo_adjusted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cargo_adjusted_by_email text;

ALTER TABLE public.overseas_purchase_order_items
  ADD COLUMN IF NOT EXISTS original_supplier_cost numeric,
  ADD COLUMN IF NOT EXISTS allocated_cargo_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_landed_cost numeric;

CREATE OR REPLACE FUNCTION public.apply_overseas_po_cargo_adjustment(
  _po_id uuid,
  _cargo_cost numeric,
  _shipping_fee numeric,
  _customs_fee numeric,
  _delivery_fee numeric,
  _misc_charges numeric,
  _notes text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid;
  uemail text;
  total_charges numeric;
  total_qty numeric;
  per_unit numeric;
  po_rec record;
  li record;
  supplier_cost_php numeric;
  landed numeric;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  total_charges := COALESCE(_cargo_cost,0) + COALESCE(_shipping_fee,0)
    + COALESCE(_customs_fee,0) + COALESCE(_delivery_fee,0) + COALESCE(_misc_charges,0);

  SELECT po.po_number, po.currency, COALESCE(po.exchange_rate,1) AS exchange_rate, s.name AS supplier_name
    INTO po_rec
    FROM public.overseas_purchase_orders po
    LEFT JOIN public.overseas_suppliers s ON s.id = po.supplier_id
   WHERE po.id = _po_id;

  SELECT COALESCE(SUM(received_quantity),0) INTO total_qty
    FROM public.overseas_purchase_order_items WHERE po_id = _po_id;

  IF total_qty <= 0 THEN
    RAISE EXCEPTION 'No received quantity to allocate cargo against';
  END IF;

  per_unit := total_charges / total_qty;

  FOR li IN
    SELECT id, item_id, unit_cost, received_quantity
      FROM public.overseas_purchase_order_items
     WHERE po_id = _po_id AND received_quantity > 0
  LOOP
    supplier_cost_php := COALESCE(li.unit_cost, 0) * COALESCE(po_rec.exchange_rate, 1);
    landed := supplier_cost_php + per_unit;

    UPDATE public.overseas_purchase_order_items
       SET original_supplier_cost = COALESCE(original_supplier_cost, COALESCE(li.unit_cost,0)),
           allocated_cargo_per_unit = per_unit,
           final_landed_cost = landed
     WHERE id = li.id;

    IF li.item_id IS NOT NULL THEN
      PERFORM public.record_item_cost_change(
        li.item_id,
        landed,
        'overseas_po_cargo_adjustment',
        _po_id,
        po_rec.po_number,
        po_rec.supplier_name,
        po_rec.currency,
        po_rec.exchange_rate,
        COALESCE(_notes, 'Landed cost after cargo allocation'),
        uid,
        uemail
      );
    END IF;
  END LOOP;

  UPDATE public.overseas_purchase_orders
     SET cargo_cost = COALESCE(_cargo_cost,0),
         shipping_fee = COALESCE(_shipping_fee,0),
         customs_fee = COALESCE(_customs_fee,0),
         delivery_fee = COALESCE(_delivery_fee,0),
         misc_charges = COALESCE(_misc_charges,0),
         total_additional_charges = total_charges,
         cargo_notes = COALESCE(_notes,''),
         cargo_adjusted_at = now(),
         cargo_adjusted_by_email = uemail,
         status = 'cargo_adjusted',
         updated_at = now()
   WHERE id = _po_id;
END;
$$;
