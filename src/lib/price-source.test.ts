import { describe, expect, it } from "vitest";
import { priceSourceClass, priceSourceLabel } from "./price-source";

describe("priceSourceLabel", () => {
  it("names each source", () => {
    expect(priceSourceLabel("previous")).toBe("Previous price");
    expect(priceSourceLabel("standard")).toBe("Standard selling price");
    expect(priceSourceLabel("manual")).toBe("Entered by hand");
    expect(priceSourceLabel("saved")).toBe("Saved price");
  });
  it("names the price list price by its column", () => {
    expect(priceSourceLabel("list:bottom")).toBe("Price list: Bottom");
    expect(priceSourceLabel("list:srp")).toBe("Price list: SRP");
    expect(priceSourceLabel("list:sdp")).toBe("Price list: SDP");
  });
});

describe("priceSourceClass", () => {
  it("gives previous, Bottom, SRP and SDP their own colors", () => {
    const classes = ["previous", "list:bottom", "list:srp", "list:sdp"].map((s) => priceSourceClass(s as never));
    expect(new Set(classes).size).toBe(4);
    expect(priceSourceClass("previous")).toContain("blue");
  });
});
