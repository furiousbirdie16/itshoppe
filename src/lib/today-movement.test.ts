import { describe, expect, it } from "vitest";
import { buildTodayRows, netSold, soldLabel, type MovementLike } from "./today-movement";

const mv = (p: Partial<MovementLike>): MovementLike => ({
  item_id: "i1", branch_id: "mnl", type: "out_invoice", quantity: 1, unit: "pcs", reference_type: "invoice", ...p,
});

describe("netSold", () => {
  it("adds invoice and online sales and takes off sales undone today", () => {
    const m = netSold([
      mv({ quantity: 5 }),
      mv({ type: "out_online_sale", quantity: 3, reference_type: "online_sale" }),
      mv({ type: "in_po", quantity: 2, reference_type: "online_sale_returned" }),
      mv({ type: "in_po", quantity: 100, reference_type: "overseas_purchase_order" }),
    ]);
    expect(m.get("pcs")).toBe(6);
  });
});

describe("soldLabel", () => {
  it("is a number for pieces and says the unit otherwise", () => {
    expect(soldLabel(new Map([["pcs", 6]]))).toBe(6);
    expect(soldLabel(new Map([["m", 50]]))).toBe("50 m");
    expect(soldLabel(new Map([["m", 50], ["pcs", 2]]))).toBe("50 m + 2 pcs");
    expect(soldLabel(new Map())).toBe(0);
  });
});

describe("buildTodayRows", () => {
  const look = {
    itemName: (id: string) => ({ i1: "HDMI cable 1.5m", i2: "CAT6 Pure Copper", i3: "RJ45" } as Record<string, string>)[id],
    branchCode: (id: string | null) => (id === "gsn" ? "GSN" : "MNL"),
    left: (id: string, b: string | null) => `${id}@${b}`,
  };

  it("lists each product that moved, per branch, sales or not — transfers left out", () => {
    const rows = buildTodayRows([
      mv({ item_id: "i1", quantity: 2 }),
      mv({ item_id: "i1", quantity: 1 }),
      mv({ item_id: "i2", type: "out_invoice", quantity: 50, unit: "m" }),
      mv({ item_id: "i3", type: "adjust_surplus", quantity: 10, reference_type: "manual_adjustment" }),
      mv({ item_id: "i4", type: "transfer_b2b_in", quantity: 10, reference_type: "stock_transfer" }),
      mv({ item_id: "i5", type: "transfer_w2s", quantity: 3, reference_type: "transfer" }),
      mv({ item_id: "i1", branch_id: "gsn", quantity: 4 }),
    ], look);
    expect(rows).toEqual([
      { Branch: "GSN", "Product Name": "HDMI cable 1.5m", "Sold Today": 4, "Quantity Left": "i1@gsn", "Actual Count": "" },
      { Branch: "MNL", "Product Name": "CAT6 Pure Copper", "Sold Today": "50 m", "Quantity Left": "i2@mnl", "Actual Count": "" },
      { Branch: "MNL", "Product Name": "HDMI cable 1.5m", "Sold Today": 3, "Quantity Left": "i1@mnl", "Actual Count": "" },
      { Branch: "MNL", "Product Name": "RJ45", "Sold Today": 0, "Quantity Left": "i3@mnl", "Actual Count": "" },
    ]);
  });
});
