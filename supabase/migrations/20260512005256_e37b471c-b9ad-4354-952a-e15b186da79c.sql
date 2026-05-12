
-- 1. Table
CREATE TABLE public.item_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  supplier_id uuid,
  overseas_supplier_id uuid,
  supplier_sku text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'PHP',
  latest_cost numeric NOT NULL DEFAULT 0,
  moq integer NOT NULL DEFAULT 1,
  lead_time_days integer,
  last_purchased_at timestamptz,
  is_primary boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_email text,
  CONSTRAINT item_suppliers_one_supplier CHECK (
    (supplier_id IS NOT NULL AND overseas_supplier_id IS NULL)
    OR (supplier_id IS NULL AND overseas_supplier_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX item_suppliers_item_local_uniq
  ON public.item_suppliers(item_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE UNIQUE INDEX item_suppliers_item_overseas_uniq
  ON public.item_suppliers(item_id, overseas_supplier_id)
  WHERE overseas_supplier_id IS NOT NULL;

CREATE UNIQUE INDEX item_suppliers_one_primary_per_item
  ON public.item_suppliers(item_id) WHERE is_primary = true;

CREATE INDEX item_suppliers_item_idx ON public.item_suppliers(item_id);

ALTER TABLE public.item_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view item suppliers"
  ON public.item_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert item suppliers"
  ON public.item_suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update item suppliers"
  ON public.item_suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete item suppliers"
  ON public.item_suppliers FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_item_suppliers_updated_at
  BEFORE UPDATE ON public.item_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Single primary trigger
CREATE OR REPLACE FUNCTION public.enforce_single_primary_supplier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE public.item_suppliers
       SET is_primary = false
     WHERE item_id = NEW.item_id
       AND id <> NEW.id
       AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_item_suppliers_single_primary
  AFTER INSERT OR UPDATE OF is_primary ON public.item_suppliers
  FOR EACH ROW WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.enforce_single_primary_supplier();

-- 3. Auto upsert from received local PO
CREATE OR REPLACE FUNCTION public.upsert_item_supplier_from_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_supplier uuid;
  v_existing uuid;
  v_has_primary boolean;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.received_quantity,0) <= COALESCE(OLD.received_quantity,0) THEN
    RETURN NEW;
  END IF;
  SELECT supplier_id INTO v_supplier FROM public.purchase_orders WHERE id = NEW.po_id;
  IF v_supplier IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_existing FROM public.item_suppliers
   WHERE item_id = NEW.item_id AND supplier_id = v_supplier;

  IF v_existing IS NOT NULL THEN
    UPDATE public.item_suppliers
       SET latest_cost = NEW.unit_cost,
           last_purchased_at = now(),
           currency = 'PHP',
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.item_suppliers WHERE item_id = NEW.item_id AND is_primary)
      INTO v_has_primary;
    INSERT INTO public.item_suppliers (item_id, supplier_id, currency, latest_cost, last_purchased_at, is_primary)
    VALUES (NEW.item_id, v_supplier, 'PHP', NEW.unit_cost, now(), NOT v_has_primary);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_upsert_item_supplier
  AFTER UPDATE OF received_quantity ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.upsert_item_supplier_from_po();

-- 4. Auto upsert from received overseas PO
CREATE OR REPLACE FUNCTION public.upsert_item_supplier_from_overseas_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_supplier uuid;
  v_currency text;
  v_existing uuid;
  v_has_primary boolean;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.received_quantity,0) <= COALESCE(OLD.received_quantity,0) THEN
    RETURN NEW;
  END IF;
  SELECT supplier_id, currency INTO v_supplier, v_currency
    FROM public.overseas_purchase_orders WHERE id = NEW.po_id;
  IF v_supplier IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_existing FROM public.item_suppliers
   WHERE item_id = NEW.item_id AND overseas_supplier_id = v_supplier;

  IF v_existing IS NOT NULL THEN
    UPDATE public.item_suppliers
       SET latest_cost = NEW.unit_cost,
           currency = COALESCE(v_currency,'USD'),
           last_purchased_at = now(),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.item_suppliers WHERE item_id = NEW.item_id AND is_primary)
      INTO v_has_primary;
    INSERT INTO public.item_suppliers (item_id, overseas_supplier_id, currency, latest_cost, last_purchased_at, is_primary)
    VALUES (NEW.item_id, v_supplier, COALESCE(v_currency,'USD'), NEW.unit_cost, now(), NOT v_has_primary);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_overseas_po_upsert_item_supplier
  AFTER UPDATE OF received_quantity ON public.overseas_purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.upsert_item_supplier_from_overseas_po();
