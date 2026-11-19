import { describe, expect, it } from "vitest";
import { priceSourceLabel } from "./price-source";

describe("priceSourceLabel", () => {
  it("names customer and standard sources", () => {
    expect(priceSourceLabel("fixed")).toBe("Customer's fixed price");
    expect(priceSourceLabel("last")).toBe("Customer's last price");
    expect(priceSourceLabel("standard")).toBe("Standard selling price");
    expect(priceSourceLabel("manual")).toBe("Entered by hand");
    expect(priceSourceLabel("saved")).toBe("Saved price");
  });
  it("names the price list price by its column", () => {
    expect(priceSourceLabel("list:bottom")).toBe("Price list: Bottom");
    expect(priceSourceLabel("list:srp")).toBe("Price list: SRP");
    expect(priceSourceLabel("list:vip")).toBe("Price list: VIP");
    expect(priceSourceLabel("list:dp")).toBe("Price list: DP");
  });
});
