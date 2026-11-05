-- Cleaning up the category list: how many entries use each name, merging
-- several at once, and deleting one that nothing uses.

-- Entries per category name across bank/cash entries, payables and recurring
-- bills, matched the way categories are (case and spaces ignored).
CREATE OR REPLACE FUNCTION public.expense_category_usage()
RETURNS TABLE (category_key TEXT, entries BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT lower(btrim(c)), count(*)
    FROM (
      SELECT category AS c FROM public.cash_transactions
      UNION ALL SELECT category FROM public.payables
      UNION ALL SELECT category FROM public.recurring_expenses
    ) used
   WHERE btrim(coalesce(c, '')) <> ''
   GROUP BY 1;
$$;

-- Several categories into one, all or nothing.
CREATE OR REPLACE FUNCTION public.merge_expense_categories(p_from UUID[], p_into UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f UUID;
  merged INTEGER := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can merge categories';
  END IF;
  IF p_into = ANY (p_from) THEN
    RAISE EXCEPTION 'The category to merge into cannot be one of those being merged';
  END IF;
  FOREACH f IN ARRAY p_from LOOP
    PERFORM public.merge_expense_category(f, p_into);
    merged := merged + 1;
  END LOOP;
  RETURN merged;
END;
$$;

-- Deletes a category only when no entry uses it; otherwise it has to be
-- merged, so nothing is left filed under a name the list no longer has.
CREATE OR REPLACE FUNCTION public.delete_expense_category(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat_name TEXT;
  used BIGINT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete categories';
  END IF;
  SELECT name INTO cat_name FROM public.expense_categories WHERE id = p_id;
  IF cat_name IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(entries), 0) INTO used
    FROM public.expense_category_usage() WHERE category_key = lower(btrim(cat_name));
  IF used > 0 THEN
    RAISE EXCEPTION '"%" is used by % entr%. Merge it into another category instead.',
      cat_name, used, CASE WHEN used = 1 THEN 'y' ELSE 'ies' END;
  END IF;
  DELETE FROM public.expense_categories WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expense_category_usage() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.merge_expense_categories(UUID[], UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_expense_category(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.expense_category_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_expense_categories(UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense_category(UUID) TO authenticated;
