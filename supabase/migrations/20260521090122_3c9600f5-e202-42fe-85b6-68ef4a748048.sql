
-- Helper: is an invoice status considered locked?
CREATE OR REPLACE FUNCTION public.is_invoice_status_locked(_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT _status IN ('confirmed','paid','unpaid')
$$;

CREATE OR REPLACE FUNCTION public.is_quotation_status_locked(_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT _status = 'accepted'
$$;

-- Invoice UPDATE guard
CREATE OR REPLACE FUNCTION public.guard_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_invoice_status_locked(OLD.status::text) THEN
    -- Allow full edit only when reverting to draft
    IF NEW.status::text = 'draft' THEN
      RETURN NEW;
    END IF;
    -- Transitions between locked statuses (confirmed -> paid, etc.) are allowed,
    -- but core editable fields must not change.
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.sales_agent IS DISTINCT FROM OLD.sales_agent
       OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
      RAISE EXCEPTION 'Invoice % is locked (status=%). Revert it to draft before editing.',
        OLD.invoice_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_update ON public.invoices;
CREATE TRIGGER trg_guard_invoice_update
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_update();

-- Invoice items guard (insert/update/delete blocked on locked parent)
CREATE OR REPLACE FUNCTION public.guard_invoice_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
  parent_number text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status::text, invoice_number INTO parent_status, parent_number
    FROM public.invoices WHERE id = parent_id;
  IF parent_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.is_invoice_status_locked(parent_status) THEN
    RAISE EXCEPTION 'Invoice % is locked (status=%). Revert it to draft before changing line items.',
      parent_number, parent_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_items ON public.invoice_items;
CREATE TRIGGER trg_guard_invoice_items
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_items();

-- Quotation UPDATE guard
CREATE OR REPLACE FUNCTION public.guard_quotation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_quotation_status_locked(OLD.status::text) THEN
    IF NEW.status::text = 'draft' THEN
      RETURN NEW;
    END IF;
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.quotation_date IS DISTINCT FROM OLD.quotation_date
       OR NEW.sales_agent IS DISTINCT FROM OLD.sales_agent
       OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
       OR NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date THEN
      RAISE EXCEPTION 'Quotation % is locked (status=%). Revert it to draft before editing.',
        OLD.quotation_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_quotation_update ON public.quotations;
CREATE TRIGGER trg_guard_quotation_update
BEFORE UPDATE ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.guard_quotation_update();

-- Quotation items guard
CREATE OR REPLACE FUNCTION public.guard_quotation_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
  parent_number text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT status::text, quotation_number INTO parent_status, parent_number
    FROM public.quotations WHERE id = parent_id;
  IF parent_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.is_quotation_status_locked(parent_status) THEN
    RAISE EXCEPTION 'Quotation % is locked (status=%). Revert it to draft before changing line items.',
      parent_number, parent_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_quotation_items ON public.quotation_items;
CREATE TRIGGER trg_guard_quotation_items
BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_items
FOR EACH ROW EXECUTE FUNCTION public.guard_quotation_items();
