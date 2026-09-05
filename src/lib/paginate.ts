/**
 * Read every row of a query, a page at a time.
 *
 * PostgREST caps a response at 1000 rows and reports no error when it truncates,
 * so an unpaginated read of a growing table silently starts losing rows — and a
 * total computed from them reads as a plausible smaller number rather than a
 * failure. `build` is called once per page because a range has to be applied to
 * a fresh builder.
 *
 * The query must order by something unique last — ties that straddle a page
 * boundary can otherwise be served twice or skipped entirely.
 */
export async function fetchAllRows<T>(build: () => any): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const fromIdx = page * pageSize;
    const { data, error } = await build().range(fromIdx, fromIdx + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}
