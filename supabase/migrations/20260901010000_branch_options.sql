-- Every active branch, by name only, so stock can be sent to a branch you do
-- not work at.
--
-- The branch picker was built from user_branches, which is the right list for
-- "where am I working" but the wrong one for "where is this going": a user
-- assigned only to Manila had no destination to choose, so transfers out of
-- Manila were impossible.
--
-- Names only — no stock, no figures. Mirrors cash_account_options(), which
-- exists for the same reason: you must be able to send something somewhere you
-- cannot otherwise read.

CREATE OR REPLACE FUNCTION public.branch_options()
RETURNS TABLE (id UUID, branch_name TEXT, branch_code TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.branch_name, b.branch_code
  FROM public.branches b
  WHERE b.is_active
    AND auth.uid() IS NOT NULL
  ORDER BY b.branch_code;
$$;

REVOKE ALL ON FUNCTION public.branch_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_options() TO authenticated;
