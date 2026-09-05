import { describe, it, expect } from "vitest";
import { fetchAllRows } from "@/lib/paginate";

/** Fake builder that serves `total` rows in pages, recording each range asked for. */
function fakeTable(total: number, ranges: Array<[number, number]>) {
  return () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      const rows = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i });
      return { data: rows, error: null };
    },
  });
}

describe("fetchAllRows", () => {
  it("returns everything past the 1000-row cap", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAllRows<{ id: number }>(fakeTable(2400, ranges));
    expect(rows).toHaveLength(2400);
    expect(rows[0].id).toBe(0);
    expect(rows[2399].id).toBe(2399);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after one request when the table is small", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAllRows(fakeTable(12, ranges));
    expect(rows).toHaveLength(12);
    expect(ranges).toHaveLength(1);
  });

  it("makes a second request when the first page is exactly full", async () => {
    // A full page is indistinguishable from "there may be more", so it must ask.
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAllRows(fakeTable(1000, ranges));
    expect(rows).toHaveLength(1000);
    expect(ranges).toHaveLength(2);
  });

  it("throws rather than returning a short result", async () => {
    const build = () => ({ range: async () => ({ data: null, error: { message: "boom" } }) });
    await expect(fetchAllRows(build)).rejects.toMatchObject({ message: "boom" });
  });
});
