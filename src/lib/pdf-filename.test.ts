import { describe, it, expect } from "vitest";
import { pdfFileName } from "./pdf";

describe("pdfFileName", () => {
  it("quotation: company, number, customer", () => {
    expect(pdfFileName({ type: "quotation", number: "QT-00538", recipientName: "jason" })).toBe("IT-Shoppe QT-00538 - Jason");
  });
  it("invoice keeps capitals as typed and drops characters files cannot hold", () => {
    expect(pdfFileName({ type: "invoice", number: "INV-01719", recipientName: "JABS / grand  media" })).toBe("IT-Shoppe INV-01719 - JABS Grand Media");
  });
  it("no customer, and purchase orders unchanged", () => {
    expect(pdfFileName({ type: "invoice", number: "INV-1", recipientName: "" })).toBe("IT-Shoppe INV-1");
    expect(pdfFileName({ type: "quotation", number: "QT-1", recipientName: "—" })).toBe("IT-Shoppe QT-1");
    expect(pdfFileName({ type: "purchase_order", number: "PO-00063", recipientName: "Supplier" })).toBe("PO-00063");
  });
});
