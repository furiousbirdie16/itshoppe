import { describe, expect, it } from "vitest";
import { checkKey, parsePayablesSheet, sheetDate, TEMPLATE_HEADERS } from "./payables-upload";

const accounts = [{ id: "bdo1", name: "BDO Main" }, { id: "bpi1", name: "BPI" }];

describe("parsePayablesSheet", () => {
  it("reads checks and bills from the template", () => {
    const rows = parsePayablesSheet([
      TEMPLATE_HEADERS,
      ["Meralco", "12,500.00", "000123", "11/15/2026", "BDO", "BDO Main", "10/27/2026", "Utilities", ""],
      ["Office rent", 30000, "", "2026-11-01", "", "", "", "Rent", "Nov"],
    ], accounts, new Set());
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({
      payee: "Meralco", amount: 12500, is_check: true, check_number: "000123", check_bank: "BDO",
      due_date: "2026-11-15", date_written: "2026-10-27", cash_account_id: "bdo1", valid: true,
    });
    expect(rows![1]).toMatchObject({ payee: "Office rent", is_check: false, check_bank: "", date_written: null, due_date: "2026-11-01", valid: true });
  });

  it("matches the account by name, ignoring case", () => {
    const [r] = parsePayablesSheet([TEMPLATE_HEADERS, ["X", 1, "", "", "", "bpi", "", "", ""]], accounts, new Set())!;
    expect(r.cash_account_id).toBe("bpi1");
  });

  it("says what is wrong with a row", () => {
    const rows = parsePayablesSheet([
      TEMPLATE_HEADERS,
      ["", 100, "", "", "", "", "", "", ""],
      ["A", 0, "", "", "", "", "", "", ""],
      ["B", 50, "", "", "", "Metrobank", "", "", ""],
      ["C", 50, "", "someday", "", "", "", "", ""],
    ], accounts, new Set())!;
    expect(rows.map((r) => r.error)).toEqual(["No payee", "Amount must be more than 0", 'No account named "Metrobank"', "Check date not readable"]);
  });

  it("leaves out a check already entered, or repeated in the sheet", () => {
    const existing = new Set([checkKey("000123", "BDO")]);
    const rows = parsePayablesSheet([
      TEMPLATE_HEADERS,
      ["Meralco", 100, "000123", "", "BDO", "", "", "", ""],
      ["PLDT", 100, "000124", "", "BDO", "", "", "", ""],
      ["PLDT", 100, "000124", "", "bdo", "", "", "", ""],
    ], accounts, existing)!;
    expect(rows.map((r) => r.duplicate)).toEqual([true, false, true]);
  });

  it("does not recognise a sheet without payee and amount", () => {
    expect(parsePayablesSheet([["Order ID", "Amount Paid"]], accounts, new Set())).toBeNull();
  });
});

describe("sheetDate", () => {
  it("reads the usual forms", () => {
    expect(sheetDate("11/15/2026")).toBe("2026-11-15");
    expect(sheetDate("2026-11-15")).toBe("2026-11-15");
    expect(sheetDate(46341)).toBe("2026-11-15");
    expect(sheetDate("")).toBeNull();
  });
});
