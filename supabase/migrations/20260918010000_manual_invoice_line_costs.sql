-- Let a hand-typed invoice line carry a cost.
--
-- Cost rows were keyed on item_id, which is NOT NULL, so a line typed in by
-- hand — no catalogue item behind it — could not have one. The trigger said as
-- much: `IF NEW.item_id IS NULL THEN RETURN NEW`. Those lines showed "No line
-- record" with no way to set a cost, and their profit never counted.
--
-- The line itself is the thing being costed, so the row now also points at the
-- invoice_items row. Catalogue lines keep their old key as well, so nothing
-- that reads them has to change at once.

ALTER TABLE public.invoice_item_financials
  ADD COLUMN IF NOT EXISTS invoice_item_id UUID
    REFERENCES public.invoice_items(id) ON DELETE SET NULL;

-- SET NULL rather than CASCADE: editing an invoice deletes and recreates its
-- lines, and a cost someone typed by hand should not vanish with them.

ALTER TABLE public.invoice_item_financials
  ALTER COLUMN item_id DROP NOT NULL;

-- ON CONFLICT needs this to upsert a hand-typed line, which has no item_id to
-- key on. Partial, because catalogue rows written before this are still null.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_item_financials_line_uniq
  ON public.invoice_item_financials(invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;

-- Point existing cost rows at the line they describe.
UPDATE public.invoice_item_financials f
SET invoice_item_id = li.id
FROM public.invoice_items li
WHERE f.invoice_item_id IS NULL
  AND li.invoice_id = f.invoice_id
  AND li.item_id IS NOT DISTINCT FROM f.item_id
  AND li.variation_id IS NOT DISTINCT FROM f.variation_id;

-- Give every hand-typed line a row, with no cost yet, so it shows as "Cost not
-- set" and can be filled in rather than reading as a missing record.
INSERT INTO public.invoice_item_financials
  (invoice_id, item_id, variation_id, invoice_item_id, cost_snapshot,
   quantity, unit_price, line_total_cost, line_profit)
SELECT li.invoice_id, NULL, li.variation_id, li.id, NULL,
       COALESCE(li.quantity, 0), COALESCE(li.unit_price, 0), NULL, NULL
FROM public.invoice_items li
WHERE li.item_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_item_financials f WHERE f.invoice_item_id = li.id
  );

-- ---------------------------------------------------------------------------
-- The trigger now covers both kinds of line.
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
  -- A hand-typed line has no catalogue cost to copy, so it starts with none and
  -- waits for someone to type one. Quantity and price still follow the line.
  IF NEW.item_id IS NULL THEN
    INSERT INTO public.invoice_item_financials
      (invoice_id, item_id, variation_id, invoice_item_id, cost_snapshot,
       quantity, unit_price, line_total_cost, line_profit)
    VALUES
      (NEW.invoice_id, NULL, NEW.variation_id, NEW.id, NULL,
       COALESCE(NEW.quantity, 0), COALESCE(NEW.unit_price, 0), NULL, NULL)
    ON CONFLICT (invoice_item_id) WHERE invoice_item_id IS NOT NULL
    DO UPDATE SET
      quantity = EXCLUDED.quantity,
      unit_price = EXCLUDED.unit_price,
      line_total_cost = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                             ELSE invoice_item_financials.cost_snapshot * EXCLUDED.quantity END,
      line_profit = CASE WHEN invoice_item_financials.cost_snapshot IS NULL THEN NULL
                         ELSE (EXCLUDED.unit_price - invoice_item_financials.cost_snapshot) * EXCLUDED.quantity END,
      updated_at = now();
    RETURN NEW;
  END IF;

  IF NEW.variation_id IS NOT NULL THEN
    -- Variation sale: use ONLY the variation's own cost. Do not fall back to parent.
    SELECT cost_price INTO v_cost FROM public.item_variations WHERE id = NEW.variation_id;
  ELSE
    -- Plain item sale (no variation): use item cost.
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
