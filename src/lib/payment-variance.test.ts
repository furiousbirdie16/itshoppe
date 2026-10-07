import { describe, it, expect } from "vitest";
import { paymentVariance } from "./payment-variance";

describe("paymentVariance", () => {
  it("reports money over as positive", () => {
    expect(paymentVariance(2000, 2200)).toBe(200);
  });

  it("reports money short as negative", () => {
    expect(paymentVariance(2000, 1850)).toBe(-150);
  });

  // The ordinary invoice: paid exactly, nothing to say about it.
  it("says nothing when the money matches", () => {
    expect(paymentVariance(2000, 2000)).toBeNull();
  });

  // An invoice settled for its own total records no separate amount at all.
  it("says nothing when no separate amount was recorded", () => {
    expect(paymentVariance(2000, null)).toBeNull();
    expect(paymentVariance(2000, undefined)).toBeNull();
  });

  it("ignores rounding below half a centavo", () => {
    expect(paymentVariance(2000, 2000.004)).toBeNull();
    expect(paymentVariance(2000, 1999.996)).toBeNull();
  });

  it("reports a centavo as a real difference", () => {
    expect(paymentVariance(2000, 2000.01)).toBeCloseTo(0.01);
  });

  it("treats a missing total as zero rather than throwing", () => {
    expect(paymentVariance(null, 500)).toBe(500);
  });
});
