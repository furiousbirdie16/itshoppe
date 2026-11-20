import { describe, it, expect, vi } from "vitest";

// One branch row: store short by 1, 20 in the warehouse.
const rows: Record<string, unknown[]> = {
  items: [{ id: "hdmi", name: "HDMI Cable", base_unit: "pcs", units_per_stock: 1 }],
  item_variations: [],
  item_branch_stock: [{ item_id: "hdmi", branch_id: "mnl", store_quantity: -1, warehouse_quantity: 20, units_per_stock: 1, open_roll_remaining: 0 }],
};
const query = (table: string) => {
  const q: any = { select: () => q, in: () => q, eq: () => q, then: (r: any) => r({ data: rows[table], error: null }) };
  return q;
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => query(t) } }));

import { checkStoreStock } from "./stockCheck";

describe("checkStoreStock with the warehouse counted", () => {
  it("allows a sale the store and warehouse cover together", async () => {
    expect(await checkStoreStock([{ item_id: "hdmi", quantity: 19 }], "mnl", { includeWarehouse: true })).toEqual([]);
  });

  it("reports what is lacking beyond both", async () => {
    const [s] = await checkStoreStock([{ item_id: "hdmi", quantity: 24 }], "mnl", { includeWarehouse: true });
    expect(s).toMatchObject({ available: 19, needed: 24, shortBy: 5, split: { store: -1, warehouse: 20 } });
  });

  it("still counts the store alone when not asked", async () => {
    const [s] = await checkStoreStock([{ item_id: "hdmi", quantity: 5 }], "mnl");
    expect(s).toMatchObject({ available: -1, shortBy: 6 });
  });
});
