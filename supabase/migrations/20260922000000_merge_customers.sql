-- Combine duplicate customer records into one.
--
-- The same customer gets entered twice (once as a walk-in, once properly), and
-- their history then splits across two rows: two "Last Paid" dates, two
-- lifetime totals, two sets of fixed prices. Deleting one loses its invoices,
-- because invoices.customer_id is ON DELETE SET NULL.
--
-- So the whole thing has to be one transaction: repoint every child row at the
-- keeper, fill in any blanks on the keeper from the records being folded in,
-- then delete them. Runs as a function so the app cannot do half of it.

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
