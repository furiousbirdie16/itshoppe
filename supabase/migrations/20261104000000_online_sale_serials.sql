-- Serials on online sales, not only on invoices.
--
-- A unit sold on Shopee or Lazada is the same unit a counter sale is, and the
-- same warranty question is asked of it later. A sold unit now belongs to
-- either an invoice line or an online sale line, never both, and the one
-- active-holder rule (uq_sold_units_active_serial) covers both kinds, so a
-- serial already on an invoice cannot also go out on a Shopee order.

ALTER TABLE public.sold_units
  ADD COLUMN IF NOT EXISTS online_sale_id UUID REFERENCES public.online_sales(id) ON DELETE SET NULL;

ALTER TABLE public.sold_units DROP CONSTRAINT IF EXISTS sold_units_one_sale;
ALTER TABLE public.sold_units
  ADD CONSTRAINT sold_units_one_sale CHECK (invoice_id IS NULL OR online_sale_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_sold_units_online_sale ON public.sold_units(online_sale_id);

ALTER TABLE public.serial_events
  ADD COLUMN IF NOT EXISTS online_sale_id UUID REFERENCES public.online_sales(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- An online sale that is cancelled, returned or deleted gives its serials back.
--
-- Done in the database rather than the page because a sale can be cancelled
-- from several places (the row, the order, the bulk edit) and all of them must
-- free the unit. Each release is written to serial_events like a manual one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_online_sale_serials()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sale_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  why TEXT;
  actor TEXT := COALESCE(auth.jwt() ->> 'email', '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    why := 'Online sale deleted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('returned', 'cancelled') THEN
    why := 'Online sale ' || NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;

  WITH freed AS (
    UPDATE public.sold_units
       SET status = 'released', notes = why, updated_at = now()
     WHERE online_sale_id = sale_id AND status = 'active'
    RETURNING id, serial
  )
  INSERT INTO public.serial_events (sold_unit_id, serial, event, online_sale_id, actor_email, notes)
  SELECT id, serial, 'released', sale_id, actor, why FROM freed;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_online_sale_release_serials_upd ON public.online_sales;
CREATE TRIGGER trg_online_sale_release_serials_upd
  AFTER UPDATE OF status ON public.online_sales
  FOR EACH ROW EXECUTE FUNCTION public.release_online_sale_serials();

DROP TRIGGER IF EXISTS trg_online_sale_release_serials_del ON public.online_sales;
CREATE TRIGGER trg_online_sale_release_serials_del
  BEFORE DELETE ON public.online_sales
  FOR EACH ROW EXECUTE FUNCTION public.release_online_sale_serials();

-- ---------------------------------------------------------------------------
-- Warranty on an online sale runs from its order date (the ship time, for a
-- Shopee upload). Editing that date moves the start of every unit on it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_online_sale_warranty_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.order_date IS DISTINCT FROM OLD.order_date THEN
    UPDATE public.sold_units
       SET warranty_starts_at = NEW.order_date, updated_at = now()
     WHERE online_sale_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_online_sale_warranty_start ON public.online_sales;
CREATE TRIGGER trg_online_sale_warranty_start
  AFTER UPDATE OF order_date ON public.online_sales
  FOR EACH ROW EXECUTE FUNCTION public.sync_online_sale_warranty_start();

REVOKE EXECUTE ON FUNCTION public.release_online_sale_serials() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sync_online_sale_warranty_start() FROM anon, public;
