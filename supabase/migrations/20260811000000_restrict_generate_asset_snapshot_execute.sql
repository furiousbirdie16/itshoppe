-- Put EXECUTE on generate_asset_snapshot() back where it belongs.
--
-- 20260808170000 had to DROP and recreate the function because its return type
-- changed from a row to void, and CREATE OR REPLACE cannot do that. The drop
-- took the original GRANT ... TO authenticated with it, and a freshly created
-- function defaults to EXECUTE for PUBLIC — which includes anon. The function
-- is SECURITY DEFINER, so that let an unauthenticated caller write a snapshot
-- row into asset_snapshots, bypassing the table's RLS.

REVOKE EXECUTE ON FUNCTION public.generate_asset_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_asset_snapshot() TO authenticated;
