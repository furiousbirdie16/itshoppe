-- Automatic proportional variation costing (costing only; no inventory logic touched)

ALTER TABLE public.item_variations
  ADD COLUMN IF NOT EXISTS cost_is_manual boolean NOT NULL DEFAULT false;

-- Existing variations that already have a cost are treated as manual overrides.
UPDATE public.item_variations SET cost_is_manual = true WHERE cost_price IS NOT NULL AND cost_is_manual = false;

CREATE OR REPLACE FUNCTION public.compute_variation_cost(_parent_cost numeric, _units_per_stock numeric, _factor numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _parent_cost IS NULL THEN NULL
    WHEN COALESCE(_units_per_stock, 1) <= 0 THEN NULL
    ELSE ROUND(_parent_cost * (COALESCE(_factor, 1) / COALESCE(_units_per_stock, 1)), 4)
  END
$$;

-- Fill auto cost on insert/update of a variation
CREATE OR REPLACE FUNCTION public.set_variation_auto_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_cost numeric;
  v_ups numeric;
BEGIN
  IF NEW.cost_is_manual THEN
    RETURN NEW;
  END IF;
  SELECT cost_price, units_per_stock INTO v_parent_cost, v_ups
  FROM public.items WHERE id = NEW.item_id;
  NEW.cost_price := public.compute_variation_cost(v_parent_cost, v_ups, NEW.factor);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variation_auto_cost ON public.item_variations;
CREATE TRIGGER trg_variation_auto_cost
BEFORE INSERT OR UPDATE OF factor, item_id, cost_is_manual, cost_price ON public.item_variations
FOR EACH ROW EXECUTE FUNCTION public.set_variation_auto_cost();

-- Propagate parent cost / units_per_stock changes to auto-cost variations
CREATE OR REPLACE FUNCTION public.propagate_item_cost_to_variations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price
     OR NEW.units_per_stock IS DISTINCT FROM OLD.units_per_stock THEN
    UPDATE public.item_variations v
      SET cost_price = public.compute_variation_cost(NEW.cost_price, NEW.units_per_stock, v.factor),
          updated_at = now()
    WHERE v.item_id = NEW.id AND v.cost_is_manual = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_cost_to_variations ON public.items;
CREATE TRIGGER trg_item_cost_to_variations
AFTER UPDATE OF cost_price, units_per_stock ON public.items
FOR EACH ROW EXECUTE FUNCTION public.propagate_item_cost_to_variations();

-- Backfill auto costs for variations without a manual override
UPDATE public.item_variations v
SET cost_price = public.compute_variation_cost(i.cost_price, i.units_per_stock, v.factor)
FROM public.items i
WHERE i.id = v.item_id AND v.cost_is_manual = false;