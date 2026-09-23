-- Keep the cost typed onto a hand-typed invoice line when the invoice is edited.
--
-- Editing an invoice does not change its lines in place: every line is deleted
-- and written again. A catalogue line does not mind, because its cost is read
-- back from the item. A line typed by hand has no item behind it, so the cost
-- someone entered had nowhere to come from and the line returned as "Cost not
-- set" — the invoice's profit quietly dropping by that line's margin.
--
-- The cost is therefore kept against the only stable thing such a line has:
-- its description on that invoice. It survives the line being destroyed and is
-- put back when a line of the same name reappears.

-- Safety net: this all keys off the link from a cost row to its line, which an
-- earlier migration added. Repeated here so this one stands on its own.
ALTER TABLE public.invoice_item_financials
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID
    REFERENCES public.invoice_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_item_financials_line_uniq
  ON public.invoice_item_financials(invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_manual_line_costs (
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  -- Compared case- and space-insensitively: re-typing " Bracket " is the same
  -- line to the person editing, so it should keep its cost.
  item_name_key TEXT NOT NULL,
  item_name TEXT NOT NULL DEFAULT '',
  cost NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT,
  PRIMARY KEY (invoice_id, item_name_key)
);

ALTER TABLE public.invoice_manual_line_costs ENABLE ROW LEVEL SECURITY;

-- Written only by the functions below, which run as definer. Admins can read it
-- to see what is being carried; nobody writes it directly.
DROP POLICY IF EXISTS "Admins read manual line costs" ON public.invoice_manual_line_costs;
CREATE POLICY "Admins read manual line costs"
  ON public.invoice_manual_line_costs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.manual_line_key(_name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT lower(btrim(coalesce(_name, ''))) $$;

-- ---------------------------------------------------------------------------
-- Remember the cost whenever one is set on a hand-typed line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remember_manual_line_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- Only hand-typed lines: a catalogue line's cost belongs to the item.
  IF NEW.item_id IS NOT NULL OR NEW.cost_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT li.item_name INTO v_name
  FROM public.invoice_items li
  WHERE li.id = NEW.invoice_item_id;

  IF v_name IS NULL OR btrim(v_name) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.invoice_manual_line_costs
    (invoice_id, item_name_key, item_name, cost, updated_by_email)
  VALUES
    (NEW.invoice_id, public.manual_line_key(v_name), v_name, NEW.cost_snapshot,
     (SELECT email FROM auth.users WHERE id = auth.uid()))
  ON CONFLICT (invoice_id, item_name_key) DO UPDATE SET
    cost = EXCLUDED.cost,
    item_name = EXCLUDED.item_name,
    updated_at = now(),
    updated_by_email = EXCLUDED.updated_by_email;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remember_manual_line_cost ON public.invoice_item_financials;
CREATE TRIGGER trg_remember_manual_line_cost
AFTER INSERT OR UPDATE OF cost_snapshot ON public.invoice_item_financials
FOR EACH ROW EXECUTE FUNCTION public.remember_manual_line_cost();

-- ---------------------------------------------------------------------------
-- Put it back when the line is written again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_invoice_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  IF NEW.variation_id IS NOT NULL THEN
    -- Variation sale: use ONLY the variation's own cost. Do not fall back to parent.
    SELECT cost_price INTO v_cost FROM public.item_variations WHERE id = NEW.variation_id;
  ELSE
    SELECT cost_price INTO v_cost FROM public.items WHERE id = NEW.item_id;
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

-- ---------------------------------------------------------------------------
-- Seed from the costs that still exist, so lines already carrying one keep it
-- through their next edit rather than starting from nothing.
-- ---------------------------------------------------------------------------
INSERT INTO public.invoice_manual_line_costs (invoice_id, item_name_key, item_name, cost)
SELECT DISTINCT ON (f.invoice_id, public.manual_line_key(li.item_name))
       f.invoice_id, public.manual_line_key(li.item_name), li.item_name, f.cost_snapshot
FROM public.invoice_item_financials f
JOIN public.invoice_items li ON li.id = f.invoice_item_id
WHERE f.item_id IS NULL
  AND f.cost_snapshot IS NOT NULL
  AND btrim(coalesce(li.item_name, '')) <> ''
ORDER BY f.invoice_id, public.manual_line_key(li.item_name), f.updated_at DESC
ON CONFLICT (invoice_id, item_name_key) DO NOTHING;
