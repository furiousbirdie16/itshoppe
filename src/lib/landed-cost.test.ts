import { describe, expect, it } from "vitest";
import { allocateCargo, cbmPerUnit, marginOf, weightedAverageCost } from "./landed-cost";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("allocateCargo", () => {
  it("splits the bill by CBM, not evenly", () => {
    const a = allocateCargo(
      [{ id: "big", qty: 40, unitCost: 300 }, { id: "small", qty: 2000, unitCost: 0.5 }],
      { cargoAmount: 50000, otherCharges: 0, lineCbm: { big: 10, small: 0.5 }, boxes: [], exchangeRate: 9.6 },
    );
    expect(a.basis).toBe("cbm");
    close(a.lines.big.cargo, 47619.05);
    close(a.lines.small.cargo, 2380.95);
    close(a.lines.big.cargoPerUnit, 1190.48);
    close(a.lines.small.cargoPerUnit, 1.19);
  });

  it("adds goods cost at the order's rate to get landed cost", () => {
    const a = allocateCargo(
      [{ id: "x", qty: 2000, unitCost: 4 }],
      { cargoAmount: 2000, otherCharges: 0, lineCbm: { x: 1 }, boxes: [], exchangeRate: 9.6 },
    );
    close(a.lines.x.goodsPerUnit, 38.4);
    close(a.lines.x.landedPerUnit, 39.4);
  });

  it("shares a mixed box's CBM among its lines by value", () => {
    const a = allocateCargo(
      [{ id: "a", qty: 100, unitCost: 30 }, { id: "b", qty: 100, unitCost: 10 }, { id: "c", qty: 10, unitCost: 100 }],
      {
        cargoAmount: 10000, otherCharges: 0,
        lineCbm: { c: 1 },
        boxes: [{ id: "box1", label: "Box 1", cbm: 4, lineIds: ["a", "b"] }],
        exchangeRate: 1,
      },
    );
    // a is worth 3000, b 1000: the 4 CBM box is 3 CBM of a and 1 of b.
    close(a.lines.a.cbm, 3);
    close(a.lines.b.cbm, 1);
    close(a.totalCbm, 5);
    close(a.lines.a.cargo, 6000);
    close(a.lines.b.cargo, 2000);
    close(a.lines.c.cargo, 2000);
  });

  it("puts other charges on the same split", () => {
    const a = allocateCargo(
      [{ id: "a", qty: 1, unitCost: 1 }, { id: "b", qty: 1, unitCost: 1 }],
      { cargoAmount: 900, otherCharges: 100, lineCbm: { a: 3, b: 1 }, boxes: [], exchangeRate: 1 },
    );
    close(a.lines.a.cargo, 750);
    close(a.lines.b.cargo, 250);
  });

  it("falls back to value, and says so, when no CBM was entered", () => {
    const a = allocateCargo(
      [{ id: "a", qty: 1, unitCost: 300 }, { id: "b", qty: 1, unitCost: 100 }],
      { cargoAmount: 400, otherCharges: 0, lineCbm: {}, boxes: [], exchangeRate: 1 },
    );
    expect(a.basis).toBe("value");
    close(a.lines.a.cargo, 300);
    close(a.lines.b.cargo, 100);
  });

  it("charges nothing to a line with no CBM when others have some", () => {
    const a = allocateCargo(
      [{ id: "a", qty: 1, unitCost: 1 }, { id: "b", qty: 1, unitCost: 1 }],
      { cargoAmount: 500, otherCharges: 0, lineCbm: { a: 2 }, boxes: [], exchangeRate: 1 },
    );
    close(a.lines.a.cargo, 500);
    close(a.lines.b.cargo, 0);
  });
});

describe("weightedAverageCost", () => {
  it("averages old stock with the new shipment (the 1000 + 2000 example)", () => {
    const r = weightedAverageCost({ currentCost: 38.2, stockNow: 3000, ordered: 2000, received: 2000, landed: 38.4 });
    expect(r.oldUnits).toBe(1000);
    expect(r.newUnits).toBe(2000);
    close(r.cost, 38.3333);
  });

  it("counts a not-yet-received line as all new", () => {
    const r = weightedAverageCost({ currentCost: 38.2, stockNow: 1000, ordered: 2000, received: 0, landed: 38.4 });
    expect(r.oldUnits).toBe(1000);
    expect(r.newUnits).toBe(2000);
    close(r.cost, 38.3333);
  });

  it("takes sales since the shipment from the older stock first", () => {
    // 1000 old + 2000 new, then 1500 sold: 1500 left, all from the new lot.
    const r = weightedAverageCost({ currentCost: 38.2, stockNow: 1500, ordered: 2000, received: 2000, landed: 38.4 });
    expect(r.oldUnits).toBe(0);
    close(r.cost, 38.4);
  });

  it("uses the landed cost when the item had no cost yet", () => {
    const r = weightedAverageCost({ currentCost: 0, stockNow: 3000, ordered: 2000, received: 2000, landed: 38.4 });
    close(r.cost, 38.4);
  });

  it("uses the landed cost when stock is negative or empty", () => {
    close(weightedAverageCost({ currentCost: 30, stockNow: -5, ordered: 10, received: 10, landed: 40 }).cost, 40);
  });
});

describe("marginOf", () => {
  it("is a fraction of the selling price", () => {
    close(marginOf(100, 75)!, 0.25);
  });
  it("is null with no selling price", () => {
    expect(marginOf(0, 10)).toBeNull();
  });
});

describe("cbmPerUnit", () => {
  it("divides a line's own CBM by its quantity", () => {
    close(cbmPerUnit(10, 40)!, 0.25);
  });
  it("is null when there is nothing to divide", () => {
    expect(cbmPerUnit(0, 40)).toBeNull();
    expect(cbmPerUnit(5, 0)).toBeNull();
  });
});

import { buildCostReview } from "./landed-cost";

describe("buildCostReview", () => {
  const alloc = allocateCargo(
    [
      { id: "l1", qty: 1000, unitCost: 4 },
      { id: "l2", qty: 1000, unitCost: 4 },
      { id: "l3", qty: 5, unitCost: 10 },
    ],
    { cargoAmount: 0, otherCharges: 0, lineCbm: { l1: 1, l2: 1 }, boxes: [], exchangeRate: 9.6 },
  );

  it("combines two lines of the same item into one row", () => {
    const rows = buildCostReview(
      [
        { lineId: "l1", itemId: "cable", itemName: "Cable", qty: 1000, received: 1000, unitCost: 4, ownCbm: 1 },
        { lineId: "l2", itemId: "cable", itemName: "Cable", qty: 1000, received: 1000, unitCost: 4, ownCbm: 1 },
      ],
      alloc,
      { cable: { itemId: "cable", currentCost: 38.2, sellingPrice: 50, stockNow: 3000 } },
      20,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ordered).toBe(2000);
    close(rows[0].landed, 38.4);
    close(rows[0].newCost, 38.3333);
    close(rows[0].cbmPerUnit!, 0.001);
  });

  it("flags a margin below the target", () => {
    const [row] = buildCostReview(
      [{ lineId: "l1", itemId: "cable", itemName: "Cable", qty: 1000, received: 1000, unitCost: 4, ownCbm: 1 }],
      alloc,
      { cable: { itemId: "cable", currentCost: 0, sellingPrice: 45, stockNow: 1000 } },
      20,
    );
    // 45 - 38.40 = 6.60, 14.7% of 45.
    close(row.margin!, 0.1467);
    expect(row.belowTarget).toBe(true);
  });

  it("does not flag an item with no selling price", () => {
    const [row] = buildCostReview(
      [{ lineId: "l1", itemId: "cable", itemName: "Cable", qty: 1000, received: 1000, unitCost: 4, ownCbm: 1 }],
      alloc,
      { cable: { itemId: "cable", currentCost: 0, sellingPrice: 0, stockNow: 1000 } },
      20,
    );
    expect(row.margin).toBeNull();
    expect(row.belowTarget).toBe(false);
  });

  it("leaves out lines with no inventory item", () => {
    const rows = buildCostReview(
      [{ lineId: "l3", itemId: null, itemName: "Freight", qty: 5, received: 5, unitCost: 10, ownCbm: 0 }],
      alloc,
      {},
      20,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("charges for chosen lines", () => {
  const lines = [
    { id: "cab4", qty: 30, unitCost: 60 },
    { id: "cab9", qty: 20, unitCost: 80 },
    { id: "panel", qty: 30, unitCost: 40 },
  ];

  it("splits a pallet among the cabinets only, by their CBM", () => {
    const a = allocateCargo(lines, {
      cargoAmount: 0, otherCharges: 0, exchangeRate: 1,
      lineCbm: { cab4: 1, cab9: 3, panel: 0.5 }, boxes: [],
      targetedCharges: [{ amount: 1600, lineIds: ["cab4", "cab9"] }],
    });
    close(a.lines.cab4.cargo, 400);
    close(a.lines.cab9.cargo, 1200);
    close(a.lines.panel.cargo, 0);
  });

  it("adds to the shared bill", () => {
    const a = allocateCargo(lines, {
      cargoAmount: 450, otherCharges: 0, exchangeRate: 1,
      lineCbm: { cab4: 1, cab9: 1, panel: 1 }, boxes: [],
      targetedCharges: [{ amount: 100, lineIds: ["panel"] }],
    });
    close(a.lines.cab4.cargo, 150);
    close(a.lines.panel.cargo, 250);
  });

  it("falls back to value among its lines when they have no CBM", () => {
    const a = allocateCargo(lines, {
      cargoAmount: 0, otherCharges: 0, exchangeRate: 1, lineCbm: {}, boxes: [],
      targetedCharges: [{ amount: 3400, lineIds: ["cab4", "cab9"] }],
    });
    // cab4 worth 1800, cab9 1600
    close(a.lines.cab4.cargo, 1800);
    close(a.lines.cab9.cargo, 1600);
  });
});
