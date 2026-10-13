import { describe, it, expect } from "vitest";
import { pickLastOverseasCosts, lastOverseasCostKey, type OverseasCostRow } from "./last-overseas-cost";

const row = (o: Partial<OverseasCostRow>): OverseasCostRow => ({
  item_id: "cable",
  unit_cost: 347,
  order_date: "2026-10-11",
  currency: "RMB",
  po_number: "OPO-00113",
  ...o,
});

const costOf = (rows: OverseasCostRow[], item = "cable", cur = "RMB") =>
  pickLastOverseasCosts(rows)[lastOverseasCostKey(item, cur)];

describe("pickLastOverseasCosts", () => {
  // The sequence this was built for: order, reorder at the same price, change
  // the price, reorder at the changed one.
  it("follows the price through a run of reorders", () => {
    const history: OverseasCostRow[] = [
      row({ order_date: "2026-10-11", unit_cost: 347 }),
      row({ order_date: "2026-10-18", unit_cost: 347 }),
    ];
    expect(costOf(history).unitCost).toBe(347);

    history.push(row({ order_date: "2026-11-01", unit_cost: 350, po_number: "OPO-00140" }));
    expect(costOf(history).unitCost).toBe(350);
    expect(costOf(history).poNumber).toBe("OPO-00140");
  });

  it("takes the latest order, whatever order the rows arrive in", () => {
    expect(
      costOf([
        row({ order_date: "2026-11-01", unit_cost: 350 }),
        row({ order_date: "2026-10-11", unit_cost: 347 }),
      ]).unitCost,
    ).toBe(350);
  });

  // A cost in yuan is not a cost in dollars, and offering one for the other
  // would be worse than offering nothing.
  it("keeps each currency's price apart", () => {
    const rows = [
      row({ order_date: "2026-10-11", unit_cost: 347, currency: "RMB" }),
      row({ order_date: "2026-11-01", unit_cost: 48, currency: "USD" }),
    ];
    expect(costOf(rows, "cable", "RMB").unitCost).toBe(347);
    expect(costOf(rows, "cable", "USD").unitCost).toBe(48);
  });

  it("keeps each item's price apart", () => {
    const rows = [
      row({ item_id: "cable", unit_cost: 347 }),
      row({ item_id: "switch", unit_cost: 1200 }),
    ];
    expect(costOf(rows, "cable").unitCost).toBe(347);
    expect(costOf(rows, "switch").unitCost).toBe(1200);
  });

  it("ignores a line nobody priced", () => {
    const rows = [
      row({ order_date: "2026-10-11", unit_cost: 347 }),
      row({ order_date: "2026-11-01", unit_cost: 0 }),
    ];
    expect(costOf(rows).unitCost).toBe(347);
  });

  it("offers nothing for an item never ordered", () => {
    expect(costOf([row({})], "never-ordered")).toBeUndefined();
  });

  it("skips hand-typed lines, which have no item to price", () => {
    expect(pickLastOverseasCosts([row({ item_id: null })])).toEqual({});
  });
});
