-- Search the whole activity log, not just what is loaded on screen.
--
-- The page used to load the newest 500 entries and search among those, so
-- anything older could not be found. Every word must appear somewhere in the
-- entry — who, the action, the module, the record, or its details (where
-- invoice and PO numbers are kept). Runs as the caller, so RLS still applies.

CREATE OR REPLACE FUNCTION public.search_activity_logs(p_words TEXT[], p_limit INT DEFAULT 500)
RETURNS SETOF public.activity_logs
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.*
  FROM public.activity_logs l
  WHERE NOT EXISTS (
    SELECT 1 FROM unnest(p_words) w
    WHERE (
      coalesce(l.user_email, '') || ' ' || coalesce(l.action, '') || ' ' ||
      coalesce(l.entity_type, '') || ' ' || coalesce(l.entity_id::text, '') || ' ' ||
      coalesce(l.details::text, '')
    ) NOT ILIKE '%' || w || '%'
  )
  ORDER BY l.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

GRANT EXECUTE ON FUNCTION public.search_activity_logs(TEXT[], INT) TO authenticated;
