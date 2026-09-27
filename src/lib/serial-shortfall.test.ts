import { describe, it, expect } from "vitest";
import { shortfallFor } from "./serial-shortfall";

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
