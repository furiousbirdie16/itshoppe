import { describe, it, expect } from "vitest";
import { paymentReferenceUrls } from "./payment-references";

describe("paymentReferenceUrls", () => {
  it("reads several screenshots back as a list", () => {
    expect(paymentReferenceUrls("https://a/1.png\nhttps://a/2.png")).toEqual([
      "https://a/1.png",
      "https://a/2.png",
    ]);
  });

  // Every payment recorded before more than one was allowed holds a bare URL.
  it("reads a single URL back as a one-image list", () => {
    expect(paymentReferenceUrls("https://a/1.png")).toEqual(["https://a/1.png"]);
  });

  it("gives nothing for a payment with no screenshot", () => {
    expect(paymentReferenceUrls(null)).toEqual([]);
    expect(paymentReferenceUrls("")).toEqual([]);
    expect(paymentReferenceUrls(undefined)).toEqual([]);
  });

  it("ignores blank lines and stray spacing", () => {
    expect(paymentReferenceUrls("  https://a/1.png  \n\n   \nhttps://a/2.png")).toEqual([
      "https://a/1.png",
      "https://a/2.png",
    ]);
  });
});
