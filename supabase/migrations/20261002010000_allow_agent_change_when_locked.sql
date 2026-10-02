-- Let the sales agent be corrected on a locked invoice.
--
-- The lock exists to stop a settled invoice being rewritten: its customer, its
-- total, its dates. The sales agent was guarded alongside them, but it is not
-- that kind of field — it records who the sale is credited to, and the moment
-- anyone notices it is wrong is long after the invoice has shipped or been
-- paid. Reverting a paid invoice to draft to fix an attribution is a far
-- bigger change than the one being made.
--
-- Everything else the guard protects is left exactly as it was.

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
    -- but core editable fields must not change. sales_agent is deliberately
    -- absent: it is an attribution, not part of what was agreed or owed.
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
      RAISE EXCEPTION 'Invoice % is locked (status=%). Revert it to draft before editing.',
        OLD.invoice_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
