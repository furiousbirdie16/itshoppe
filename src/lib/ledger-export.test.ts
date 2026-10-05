import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

// Mirrors the column map in CashLedger, to prove the shape a bookkeeper gets.
const rows = [
  { Date: "2026-10-01", Account: "BDO", Category: "Invoice Payment", "Payee / Source": "Nextline", Reference: "INV--01255", Inflow: 4850, Outflow: "", Notes: "", "Recorded By": "jason@gmail.com", "Edited By": "", Transfer: "" },
  { Date: "2026-10-02", Account: "BDO", Category: "Supplier", "Payee / Source": "BDO → Petty Cash", Reference: "", Inflow: "", Outflow: 1200, Notes: "float", "Recorded By": "angela@it.com", "Edited By": "", Transfer: "Yes" },
];

describe("ledger export shape", () => {
  it("round-trips through a workbook with inflow and outflow apart", () => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const back = XLSX.utils.sheet_to_json<any>(XLSX.read(buf).Sheets.Export);

    expect(back).toHaveLength(2);
    expect(back[0].Inflow).toBe(4850);
    // Blank, not 0 — a zero here would read as a real zero-peso movement.
    expect(back[0].Outflow ?? "").toBe("");
    expect(back[0].Outflow).not.toBe(0);
    expect(back[1].Outflow).toBe(1200);
    expect(back[1]["Payee / Source"]).toBe("BDO → Petty Cash");
    // Sums without anyone reasoning about signs.
    const net = back.reduce((s, r) => s + (Number(r.Inflow) || 0) - (Number(r.Outflow) || 0), 0);
    expect(net).toBe(3650);
  });
});
