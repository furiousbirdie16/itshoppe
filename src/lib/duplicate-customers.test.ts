import { describe, it, expect } from "vitest";
import { normalizeCustomerName, findDuplicateCustomers } from "./duplicate-customers";

const list = [
  { id: "1", name: "NRC builders" },
  { id: "2", name: "Acme Corp." },
  { id: "3", name: "Bright Hardware" },
];

describe("normalizeCustomerName", () => {
  it("sets aside case, punctuation and repeated spaces", () => {
    expect(normalizeCustomerName("  Acme   Corp. ")).toBe("acme corp");
    expect(normalizeCustomerName("Acme Corp")).toBe("acme corp");
  });
});

describe("findDuplicateCustomers", () => {
  it("flags the same name typed with different capitals", () => {
    const hits = findDuplicateCustomers("NRC Builders", list);
    expect(hits).toHaveLength(1);
    expect(hits[0].customer.id).toBe("1");
    expect(hits[0].kind).toBe("same");
  });

  it("flags a name that contains an existing one", () => {
    const hits = findDuplicateCustomers("Bright Hardware Supply", list);
    expect(hits.map((h) => h.customer.id)).toEqual(["3"]);
    expect(hits[0].kind).toBe("similar");
  });

  // Editing a customer must not warn about the customer being edited.
  it("leaves out the record being edited", () => {
    expect(findDuplicateCustomers("NRC builders", list, "1")).toEqual([]);
  });

  it("stays quiet on unrelated and very short names", () => {
    expect(findDuplicateCustomers("Zenith Steel", list)).toEqual([]);
    expect(findDuplicateCustomers("N", list)).toEqual([]);
  });

  it("puts an exact match ahead of a loose one", () => {
    const hits = findDuplicateCustomers("Acme Corp", [
      { id: "a", name: "Acme Corporation" },
      { id: "b", name: "acme corp" },
    ]);
    expect(hits.map((h) => h.customer.id)).toEqual(["b", "a"]);
  });
});
