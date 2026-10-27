import { describe, expect, it } from "vitest";
import { isShopeeExport, matchShopeeSku, missingShopeeColumns, parseShopeeExport, shopeeDate, skipReason } from "./shopee-export";

const HEADER = [
  "Order ID", "Order Status", "Return / Refund Status", "Tracking Number*", "Shipping Option",
  "Estimated Ship Out Date", "Ship Time", "Order Creation Date", "Product Name",
  "SKU Reference No.", "Variation Name", "Original Price", "Deal Price", "Quantity",
];

const line = (id: string, status: string, tracking: string, ship: string, sku: string, deal: string, qty: string) =>
  [id, status, "", tracking, "SPX", "", ship, "2026-10-21 14:08", "Name", sku, "Var", "99", deal, qty];

describe("Shopee export header", () => {
  it("is recognised", () => {
    expect(isShopeeExport(HEADER)).toBe(true);
    expect(missingShopeeColumns(HEADER)).toEqual([]);
  });
  it("names the required columns it lacks", () => {
    expect(missingShopeeColumns(["Order ID", "SKU Reference No.", "Quantity"]))
      .toEqual(["Order Status", "Tracking Number", "Ship Time", "Deal Price"]);
  });
  it("does not take the hand-made template for one", () => {
    expect(isShopeeExport(["Order ID", "Date", "Product Name", "Quantity", "Channel", "Selling Price"])).toBe(false);
  });
});

describe("parseShopeeExport", () => {
  const sheet = [
    HEADER,
    // One order, two products: two lines sharing an order ID.
    line("2610217M3QE4WF", "Shipping", "PH261372470925W", "2026-10-22 21:00", "cable clip 10mm", "29", "10"),
    line("2610217M3QE4WF", "Shipping", "PH261372470925W", "2026-10-22 21:00", "BNC Coupler 5", "49", "5"),
    line("CANCELLED1", "Cancelled", "PH1", "2026-10-22 21:00", "x", "1", "1"),
    line("UNPAID1", "Unpaid", "", "", "x", "1", "1"),
    line("NOTRACK1", "To ship", "", "", "x", "1", "1"),
  ];

  it("takes ship time, order ID, SKU, deal price and quantity", () => {
    const { rows } = parseShopeeExport(sheet);
    expect(rows).toEqual([
      { orderId: "2610217M3QE4WF", date: "2026-10-22", sku: "cable clip 10mm", dealPrice: 29, quantity: 10 },
      { orderId: "2610217M3QE4WF", date: "2026-10-22", sku: "BNC Coupler 5", dealPrice: 49, quantity: 5 },
    ]);
  });

  it("leaves out cancelled, unpaid and untracked orders, saying why", () => {
    const { skipped } = parseShopeeExport(sheet);
    expect(skipped).toEqual([
      { orderId: "CANCELLED1", reason: "Cancelled" },
      { orderId: "UNPAID1", reason: "Unpaid" },
      { orderId: "NOTRACK1", reason: "No tracking number" },
    ]);
  });
});

describe("skipReason", () => {
  it("puts cancelled and unpaid ahead of a missing tracking number", () => {
    expect(skipReason("Cancelled", "")).toBe("Cancelled");
    expect(skipReason("Unpaid", "")).toBe("Unpaid");
    expect(skipReason("Completed", "  ")).toBe("No tracking number");
    expect(skipReason("Completed", "PH1")).toBeNull();
  });
  it("treats a placeholder tracking number as none", () => {
    for (const t of ["-", "—", "N/A", "n/a", "none", " . "]) expect(skipReason("To ship", t)).toBe("No tracking number");
    expect(skipReason("To ship", "PH261372470925W")).toBeNull();
  });
});

describe("shopeeDate", () => {
  it("reads ISO, day-first and Excel serial dates", () => {
    expect(shopeeDate("2026-10-22 21:00")).toBe("2026-10-22");
    expect(shopeeDate("22/10/2026 21:00")).toBe("2026-10-22");
    expect(shopeeDate(46317)).toBe("2026-10-22");
    expect(shopeeDate("")).toBe("");
  });
});

describe("matchShopeeSku", () => {
  const items = [{ id: "i-clip", sku: "CABLE CLIP" }, { id: "i-bnc", sku: "bnc coupler 5" }];
  const variations = [{ id: "v-10", item_id: "i-clip", sku: "cable clip 10mm" }];

  it("prefers a variation's SKU, ignoring case", () => {
    expect(matchShopeeSku("Cable Clip 10mm", items, variations)).toEqual({ itemId: "i-clip", variationId: "v-10" });
  });
  it("falls back to an item's SKU", () => {
    expect(matchShopeeSku("BNC Coupler 5", items, variations)).toEqual({ itemId: "i-bnc", variationId: null });
  });
  it("reports no match", () => {
    expect(matchShopeeSku("nope", items, variations).itemId).toBeNull();
  });
});
