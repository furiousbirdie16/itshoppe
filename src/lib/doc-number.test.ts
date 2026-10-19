import { describe, expect, it } from "vitest";
import { docNo } from "./doc-number";

describe("docNo", () => {
  it("collapses the doubled dash", () => {
    expect(docNo("INV--01191")).toBe("INV-01191");
    expect(docNo("OPO--00092")).toBe("OPO-00092");
  });
  it("leaves a single dash alone", () => {
    expect(docNo("PO-00012")).toBe("PO-00012");
  });
  it("leaves numbers without dashes alone", () => {
    expect(docNo("261013HBNKXSKQ")).toBe("261013HBNKXSKQ");
  });
  it("passes empty values through", () => {
    expect(docNo(null)).toBe("");
    expect(docNo(undefined)).toBe("");
    expect(docNo("")).toBe("");
  });
});
