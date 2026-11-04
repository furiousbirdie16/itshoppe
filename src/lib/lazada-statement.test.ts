import { describe, expect, it } from "vitest";
import { fixSheetRange, isLazadaStatement, lazadaHeaderIndex, parseLazadaStatement } from "./lazada-statement";

describe("fixSheetRange", () => {
  it("widens a sheet whose stated size leaves out columns", () => {
    const ws: Record<string, unknown> = { "!ref": "A1:A3", A1: {}, S1: {}, B3: {}, AA2: {} };
    fixSheetRange(ws);
    expect(ws["!ref"]).toBe("A1:AA3");
  });
});

// Laid out as Lazada's own export (columns trimmed of the ones not read).
const HEADER = [
  "Statement Period", "Statement Number", "Transaction Date", "Fee Name", "Amount(Include Tax)", "VAT Amount",
  "Release Status", "Release Date", "Comment", "Order Creation Date", "Order Number", "Order Line ID",
  "Seller SKU", "Lazada SKU", "WHT Amount", "WHT included in Amount", "Order Status", "Product Name", "Short Code",
];
const row = (statement: string, fee: string, amount: string, order: string, line: string, status = "Confirmed", release = "Released to My Balance") =>
  ["", statement, "", fee, amount, "0", release, "", "", "28 Sep 2026", order, line, "SKU", "", "0", "NO", status, "", ""];

describe("Lazada statement export", () => {
  it("is recognised by its header", () => {
    expect(lazadaHeaderIndex([HEADER])).toBe(0);
    expect(isLazadaStatement([HEADER])).toBe(true);
    expect(isLazadaStatement([["Order Number", "Amount"], ["1", "2"]])).toBe(false);
  });

  it("adds up every unit and fee of an order, across statements", () => {
    const { orders, statementTotals } = parseLazadaStatement([
      HEADER,
      row("S-1003", "Item Price Credit", "42", "A1", "L1"),
      row("S-1003", "Commission", "-4.41", "A1", "L1"),
      row("S-1003", "Item Price Credit", "42", "A1", "L2"),
      row("S-1003", "Commission", "-4.41", "A1", "L2"),
      row("S-1004", "Sponsored Affiliates", "-2.82", "A1", "L1"),
    ]);
    expect(orders).toEqual([
      { orderId: "A1", amount: 72.36, units: 2, statements: ["S-1003", "S-1004"], complete: true, returned: false },
    ]);
    expect(statementTotals).toEqual({ "S-1003": 75.18, "S-1004": -2.82 });
  });

  it("marks an order with only late fees as partial", () => {
    const { orders } = parseLazadaStatement([HEADER, row("S-1004", "Sponsored Affiliates", "-2.82", "A1", "L1")]);
    expect(orders[0].complete).toBe(false);
  });

  it("keeps shop-level charges apart and skips unreleased rows", () => {
    const { orders, shopCharges, notReleased } = parseLazadaStatement([
      HEADER,
      row("S-1", "Withholding Tax (LZD - Adj Debit)", "-9.5", "", ""),
      row("S-1", "Item Price Credit", "42", "B1", "L1", "Returned"),
      row("S-1", "Reversal Item Price", "-42", "B1", "L1", "Returned"),
      row("S-1", "Shipping Fee Refund to Customer", "-3.33", "B1", "L1", "Returned"),
      row("S-2", "Item Price Credit", "99", "C1", "L1", "Confirmed", "Not Released"),
    ]);
    expect(shopCharges).toEqual([{ feeName: "Withholding Tax (LZD - Adj Debit)", amount: -9.5, statement: "S-1" }]);
    expect(orders).toEqual([
      { orderId: "B1", amount: -3.33, units: 1, statements: ["S-1"], complete: true, returned: true },
    ]);
    expect(notReleased).toBe(1);
  });
});
