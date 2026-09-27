import { describe, it, expect } from "vitest";
import { warrantyStatus } from "./warranty";

describe("warrantyStatus", () => {
  // The case the whole feature exists for: three identical units bought a month
  // apart, one of them returned on September 25.
  it("tells the August unit apart from the September one", () => {
    const now = new Date("2026-09-25");
    const august = warrantyStatus({ warranty_starts_at: "2026-08-01", warranty_months: 1 }, now);
    const september = warrantyStatus({ warranty_starts_at: "2026-09-01", warranty_months: 1 }, now);

    expect(august.state).toBe("expired");
    expect(september.state).toBe("covered");
  });

  it("counts the last covered day as covered", () => {
    const s = warrantyStatus({ warranty_starts_at: "2026-08-25", warranty_months: 1 }, new Date("2026-09-25"));
    expect(s.state).toBe("covered");
    expect(s.daysLeft).toBe(0);
  });

  // One month from August 1 runs to September 1, so September 25 is 24 days
  // past it — not 25. The boundary is inclusive of the anniversary date.
  it("reports how long ago an expired warranty ran out", () => {
    const s = warrantyStatus({ warranty_starts_at: "2026-08-01", warranty_months: 1 }, new Date("2026-09-25"));
    expect(s.daysLeft).toBe(-24);
  });

  // Payment does not start the clock, so an invoice never marked shipped has no
  // start date. Guessing one would hand out cover nobody agreed to.
  it("does not start the clock without a collection date", () => {
    const s = warrantyStatus({ warranty_starts_at: null, warranty_months: 12 });
    expect(s.state).toBe("not_started");
    expect(s.expiresAt).toBeNull();
  });

  it("treats a product with no warranty period as uncovered rather than expired", () => {
    const s = warrantyStatus({ warranty_starts_at: "2026-08-01", warranty_months: 0 }, new Date("2026-09-25"));
    expect(s.state).toBe("none");
    expect(s.daysLeft).toBeNull();
  });

  it("survives a malformed stored date", () => {
    const s = warrantyStatus({ warranty_starts_at: "not a date", warranty_months: 6 });
    expect(s.state).toBe("none");
  });
});
