import { describe, it, expect } from "vitest";
import { shortfallFor, serialTrackingApplies } from "./serial-shortfall";

const poe = (id: string, quantity: number) => ({
  id, quantity, items: { name: "POE Injector", track_serials: true },
});

describe("shortfallFor", () => {
  it("reports nothing when every unit is accounted for", () => {
    const out = shortfallFor(
      [poe("line-1", 2)],
      [{ invoice_item_id: "line-1" }, { invoice_item_id: "line-1" }],
    );
    expect(out).toEqual([]);
  });

  it("counts what is still missing", () => {
    const out = shortfallFor([poe("line-1", 3)], [{ invoice_item_id: "line-1" }]);
    expect(out).toEqual([
      { invoice_item_id: "line-1", item_name: "POE Injector", needed: 3, recorded: 1 },
    ]);
  });

  // Raising a quantity after scanning must not discard the serials already
  // captured — it just asks for one more.
  it("keeps existing scans when the quantity goes up", () => {
    const units = [{ invoice_item_id: "line-1" }, { invoice_item_id: "line-1" }];
    expect(shortfallFor([poe("line-1", 2)], units)).toEqual([]);
    expect(shortfallFor([poe("line-1", 3)], units)[0]).toMatchObject({ needed: 3, recorded: 2 });
  });

  it("ignores products that do not ask for serials", () => {
    const out = shortfallFor(
      [{ id: "line-2", quantity: 10, items: { name: "UTP Cable", track_serials: false } }],
      [],
    );
    expect(out).toEqual([]);
  });

  it("ignores a custom line with no product behind it", () => {
    const out = shortfallFor([{ id: "line-3", quantity: 1, item_name: "Labour", items: null }], []);
    expect(out).toEqual([]);
  });

  // Serials belonging to another line on the same invoice must not be counted
  // toward this one.
  it("does not borrow serials from a different line", () => {
    const out = shortfallFor(
      [poe("line-1", 1), poe("line-2", 1)],
      [{ invoice_item_id: "line-1" }, { invoice_item_id: "line-1" }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].invoice_item_id).toBe("line-2");
  });
});

describe("serialTrackingApplies", () => {
  // Serials were not being asked for before the feature shipped, so the whole
  // back catalogue reported as short and buried the invoices that matter.
  it("exempts invoices raised before tracking began", () => {
    expect(serialTrackingApplies("2026-09-26T23:59:00Z")).toBe(false);
    expect(serialTrackingApplies("2025-01-15T10:00:00Z")).toBe(false);
  });

  it("covers invoices raised on or after the start date", () => {
    expect(serialTrackingApplies("2026-09-27T00:00:01Z")).toBe(true);
    expect(serialTrackingApplies("2026-10-02T08:30:00Z")).toBe(true);
  });

  // Read from when the invoice was raised, not its invoice date: an invoice
  // back-dated today was still written with the scanner to hand.
  it("treats a missing date as out of scope rather than guessing", () => {
    expect(serialTrackingApplies(null)).toBe(false);
    expect(serialTrackingApplies(undefined)).toBe(false);
    expect(serialTrackingApplies("")).toBe(false);
  });
});
