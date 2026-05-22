-- Customer classification + follow-up tracking
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz;

-- Validate classification values via trigger (allows future expansion)
CREATE OR REPLACE FUNCTION public.validate_customer_classification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.classification NOT IN ('retail','wholesale','recurring') THEN
    RAISE EXCEPTION 'Invalid customer classification: %', NEW.classification;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_customer_classification ON public.customers;
CREATE TRIGGER trg_validate_customer_classification
BEFORE INSERT OR UPDATE OF classification ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_classification();

-- Follow-up history table
CREATE TABLE IF NOT EXISTS public.customer_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  followed_up_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  user_email text,
  sales_agent text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_follow_ups_customer ON public.customer_follow_ups(customer_id, followed_up_at DESC);

ALTER TABLE public.customer_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth view follow-ups" ON public.customer_follow_ups;
CREATE POLICY "Auth view follow-ups" ON public.customer_follow_ups
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth insert follow-ups" ON public.customer_follow_ups;
CREATE POLICY "Auth insert follow-ups" ON public.customer_follow_ups
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admins manage follow-ups" ON public.customer_follow_ups;
CREATE POLICY "Admins manage follow-ups" ON public.customer_follow_ups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Sync customers.last_follow_up_at whenever a follow-up is recorded
CREATE OR REPLACE FUNCTION public.sync_customer_last_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customers
     SET last_follow_up_at = NEW.followed_up_at
   WHERE id = NEW.customer_id
     AND (last_follow_up_at IS NULL OR last_follow_up_at < NEW.followed_up_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_last_follow_up ON public.customer_follow_ups;
CREATE TRIGGER trg_sync_customer_last_follow_up
AFTER INSERT ON public.customer_follow_ups
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_last_follow_up();