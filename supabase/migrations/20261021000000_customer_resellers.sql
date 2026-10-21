-- Which customers came through a reseller.
--
-- A reseller is a customer of one of the sales agents who buys from us and
-- sells on at a mark-up; they are marked by classification = 'reseller', which
-- is free text and needs no change here. Their end customers are recorded
-- under the end customer's own name (so the store knows what to charge them
-- next time) with reseller_id pointing at the reseller. Invoices carry it too,
-- filled from the customer and clearable for a sale that bypassed the reseller.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

-- Deliberately no foreign key on invoices. invoices.customer_id already links
-- to customers, and a second link makes every `invoices … customers(…)` embed
-- ambiguous to PostgREST — the Invoices page, the dashboard and the payment
-- notification would all start failing. The trigger below does the one job
-- the key would have done.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reseller_id UUID;

CREATE OR REPLACE FUNCTION public.clear_deleted_reseller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invoices SET reseller_id = NULL WHERE reseller_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_deleted_reseller ON public.customers;
CREATE TRIGGER trg_clear_deleted_reseller
  AFTER DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_reseller();

CREATE INDEX IF NOT EXISTS idx_customers_reseller ON public.customers(reseller_id) WHERE reseller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_reseller ON public.invoices(reseller_id) WHERE reseller_id IS NOT NULL;

-- Merging customers must carry reseller links across, or folding a duplicate
-- reseller into its twin would quietly detach every customer it brought in.
CREATE OR REPLACE FUNCTION public.merge_customers(p_keep UUID, p_merge UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_losers UUID[];
  v_invoices INT;
  v_quotations INT;
  v_receivables INT;
  v_follow_ups INT;
  v_prices INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can merge customers';
  END IF;

  IF p_keep IS NULL OR p_merge IS NULL THEN
    RAISE EXCEPTION 'Nothing to merge';
  END IF;

  -- Never let the keeper appear on both sides, however it was passed in.
  SELECT ARRAY(SELECT DISTINCT u FROM unnest(p_merge) u WHERE u IS NOT NULL AND u <> p_keep)
    INTO v_losers;

  IF array_length(v_losers, 1) IS NULL THEN
    RAISE EXCEPTION 'Nothing to merge into this customer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_keep) THEN
    RAISE EXCEPTION 'The customer being kept no longer exists';
  END IF;

  -- The keeper takes anything it is missing. Longest wins for the address, on
  -- the grounds that the fuller entry is the better one.
  UPDATE public.customers k SET
    contact_person   = COALESCE(NULLIF(k.contact_person, ''),   src.contact_person),
    phone            = COALESCE(NULLIF(k.phone, ''),            src.phone),
    email            = COALESCE(NULLIF(k.email, ''),            src.email),
    address          = COALESCE(NULLIF(k.address, ''),          src.address),
    full_address     = COALESCE(NULLIF(k.full_address, ''),     src.full_address),
    barangay_village = COALESCE(NULLIF(k.barangay_village, ''), src.barangay_village),
    city_municipality= COALESCE(NULLIF(k.city_municipality, ''),src.city_municipality),
    district_area    = COALESCE(NULLIF(k.district_area, ''),    src.district_area),
    province_state   = COALESCE(NULLIF(k.province_state, ''),    src.province_state),
    postal_code      = COALESCE(NULLIF(k.postal_code, ''),      src.postal_code),
    country          = COALESCE(NULLIF(k.country, ''),          src.country),
    latitude         = COALESCE(k.latitude,                     src.latitude),
    longitude        = COALESCE(k.longitude,                    src.longitude),
    -- Tags are a set, so keep the union of them.
    tags             = ARRAY(SELECT DISTINCT t FROM unnest(k.tags || src.tags) t WHERE t <> ''),
    -- The earliest signup and the most recent contact are both the true ones.
    created_at       = LEAST(k.created_at, src.created_at),
    last_follow_up_at= GREATEST(k.last_follow_up_at, src.last_follow_up_at)
  FROM (
    SELECT
      (array_agg(contact_person)    FILTER (WHERE contact_person    <> ''))[1] AS contact_person,
      (array_agg(phone)             FILTER (WHERE phone             <> ''))[1] AS phone,
      (array_agg(email)             FILTER (WHERE email             <> ''))[1] AS email,
      (array_agg(address ORDER BY length(address) DESC)
                                    FILTER (WHERE address           <> ''))[1] AS address,
      (array_agg(full_address ORDER BY length(full_address) DESC)
                                    FILTER (WHERE full_address      <> ''))[1] AS full_address,
      (array_agg(barangay_village)  FILTER (WHERE barangay_village  <> ''))[1] AS barangay_village,
      (array_agg(city_municipality) FILTER (WHERE city_municipality <> ''))[1] AS city_municipality,
      (array_agg(district_area)     FILTER (WHERE district_area     <> ''))[1] AS district_area,
      (array_agg(province_state)    FILTER (WHERE province_state    <> ''))[1] AS province_state,
      (array_agg(postal_code)       FILTER (WHERE postal_code       <> ''))[1] AS postal_code,
      (array_agg(country)           FILTER (WHERE country           <> ''))[1] AS country,
      (array_agg(latitude)          FILTER (WHERE latitude  IS NOT NULL))[1]   AS latitude,
      (array_agg(longitude)         FILTER (WHERE longitude IS NOT NULL))[1]   AS longitude,
      COALESCE((SELECT array_agg(DISTINCT t)
                  FROM public.customers c2, unnest(c2.tags) t
                 WHERE c2.id = ANY(v_losers)), '{}'::text[])                   AS tags,
      MIN(created_at)                                                          AS created_at,
      MAX(last_follow_up_at)                                                   AS last_follow_up_at
    FROM public.customers
    WHERE id = ANY(v_losers)
  ) src
  WHERE k.id = p_keep;

  -- Repoint the history.
  UPDATE public.invoices   SET customer_id = p_keep WHERE customer_id = ANY(v_losers);
  GET DIAGNOSTICS v_invoices = ROW_COUNT;

  UPDATE public.quotations SET customer_id = p_keep WHERE customer_id = ANY(v_losers);
  GET DIAGNOSTICS v_quotations = ROW_COUNT;

  UPDATE public.manual_receivables SET customer_id = p_keep WHERE customer_id = ANY(v_losers);
  GET DIAGNOSTICS v_receivables = ROW_COUNT;

  UPDATE public.customer_follow_ups SET customer_id = p_keep WHERE customer_id = ANY(v_losers);
  GET DIAGNOSTICS v_follow_ups = ROW_COUNT;

  UPDATE public.customer_price_history SET customer_id = p_keep WHERE customer_id = ANY(v_losers);

  -- Fixed prices are unique per customer/item/variation, so a price the keeper
  -- already has wins and the duplicate is dropped rather than colliding.
  DELETE FROM public.customer_prices d
  WHERE d.customer_id = ANY(v_losers)
    AND EXISTS (
      SELECT 1 FROM public.customer_prices k
      WHERE k.customer_id = p_keep
        AND k.item_id = d.item_id
        AND k.variation_id IS NOT DISTINCT FROM d.variation_id
    );

  UPDATE public.customer_prices SET customer_id = p_keep WHERE customer_id = ANY(v_losers);
  GET DIAGNOSTICS v_prices = ROW_COUNT;

  -- A reseller's customers and sales follow the reseller to the keeper.
  UPDATE public.customers SET reseller_id = p_keep WHERE reseller_id = ANY(v_losers);
  UPDATE public.invoices  SET reseller_id = p_keep WHERE reseller_id = ANY(v_losers);
  -- Merging a customer into the reseller they came through would leave the
  -- keeper pointing at itself.
  UPDATE public.customers SET reseller_id = NULL WHERE id = p_keep AND reseller_id = p_keep;

  DELETE FROM public.customers WHERE id = ANY(v_losers);

  RETURN jsonb_build_object(
    'merged',      array_length(v_losers, 1),
    'invoices',    v_invoices,
    'quotations',  v_quotations,
    'receivables', v_receivables,
    'follow_ups',  v_follow_ups,
    'prices',      v_prices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_customers(UUID, UUID[]) TO authenticated;
