-- Let an admin edit a locked invoice or quotation.
--
-- The lock stops a settled document being rewritten behind everyone's back,
-- which is right for staff. For the owner it is an obstacle: the way to correct
-- a paid invoice was to revert it to draft, which unposts the payment and puts
-- the stock back, then redo all of it — a far larger change than the typo being
-- fixed, and several more chances to get it wrong.
--
-- Admins may now edit through the lock. Everyone else is unaffected, and the
-- lock is still what it was for them.

CREATE OR REPLACE FUNCTION public.guard_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF public.is_invoice_status_locked(OLD.status::text) THEN
    IF NEW.status::text = 'draft' THEN
      RETURN NEW;
    END IF;
    -- sales_agent is absent on purpose: an attribution, not what was agreed.
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
      RAISE EXCEPTION 'Invoice % is locked (status=%). Ask an admin, or revert it to draft before editing.',
        OLD.invoice_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_invoice_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
  parent_number text;
  parent_id uuid;
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status::text, invoice_number INTO parent_status, parent_number
    FROM public.invoices WHERE id = parent_id;
  IF parent_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.is_invoice_status_locked(parent_status) THEN
    RAISE EXCEPTION 'Invoice % is locked (status=%). Ask an admin, or revert it to draft before changing line items.',
      parent_number, parent_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_quotation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

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
      RAISE EXCEPTION 'Quotation % is locked (status=%). Ask an admin, or revert it to draft before editing.',
        OLD.quotation_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_quotation_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
  parent_number text;
  parent_id uuid;
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  parent_id := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT status::text, quotation_number INTO parent_status, parent_number
    FROM public.quotations WHERE id = parent_id;
  IF parent_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.is_quotation_status_locked(parent_status) THEN
    RAISE EXCEPTION 'Quotation % is locked (status=%). Ask an admin, or revert it to draft before changing line items.',
      parent_number, parent_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
