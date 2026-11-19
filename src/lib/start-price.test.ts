import { describe, expect, it } from "vitest";
import { isOwnList, resolveStartPrice } from "./start-price";

const own = { brand: "NXT IT Shoppe", bottom: 1300, srp: 1500, sdp: null };
const tplink = { brand: "TP-Link", bottom: 900, srp: 1100, sdp: 800 };
const hik = { brand: "Hikvision", bottom: null, srp: null, sdp: 2000 };

describe("isOwnList", () => {
  it("knows your list by its IT Shoppe brand", () => {
    expect(isOwnList("NXT IT Shoppe")).toBe(true);
    expect(isOwnList("IT Shoppe")).toBe(true);
    expect(isOwnList("ITShoppe dealer")).toBe(true);
    expect(isOwnList("Hikvision")).toBe(false);
    expect(isOwnList(null)).toBe(false);
  });
});

describe("resolveStartPrice", () => {
  it("uses the customer's previous price over any list price", () => {
    expect(resolveStartPrice({ walkIn: false, previous: 1400, list: own, standard: 1600 })).toEqual({ price: 1400, source: "previous" });
    expect(resolveStartPrice({ walkIn: false, previous: 1400, list: hik, standard: null })).toEqual({ price: 1400, source: "previous" });
  });

  it("ignores a previous price for walk-ins", () => {
    expect(resolveStartPrice({ walkIn: true, previous: 1400, list: own, standard: 1600 })).toEqual({ price: 1500, source: "list:srp" });
  });

  it("your list: Bottom, or SRP for a walk-in, each falling back to the other", () => {
    expect(resolveStartPrice({ walkIn: false, previous: null, list: own, standard: 1600 })).toEqual({ price: 1300, source: "list:bottom" });
    expect(resolveStartPrice({ walkIn: true, previous: null, list: own, standard: 1600 })).toEqual({ price: 1500, source: "list:srp" });
    expect(resolveStartPrice({ walkIn: false, previous: null, list: { ...own, bottom: null }, standard: null })).toEqual({ price: 1500, source: "list:srp" });
    expect(resolveStartPrice({ walkIn: true, previous: null, list: { ...own, srp: null }, standard: null })).toEqual({ price: 1300, source: "list:bottom" });
  });

  it("supplier lists: Bottom, else SDP, walk-ins too", () => {
    expect(resolveStartPrice({ walkIn: false, previous: null, list: tplink, standard: null })).toEqual({ price: 900, source: "list:bottom" });
    expect(resolveStartPrice({ walkIn: true, previous: null, list: tplink, standard: null })).toEqual({ price: 900, source: "list:bottom" });
    expect(resolveStartPrice({ walkIn: false, previous: null, list: hik, standard: null })).toEqual({ price: 2000, source: "list:sdp" });
    expect(resolveStartPrice({ walkIn: true, previous: null, list: hik, standard: null })).toEqual({ price: 2000, source: "list:sdp" });
  });

  it("falls back to the standard price, then to nothing", () => {
    expect(resolveStartPrice({ walkIn: false, previous: 0, list: null, standard: 750 })).toEqual({ price: 750, source: "standard" });
    expect(resolveStartPrice({ walkIn: false, previous: null, list: { ...hik, sdp: null }, standard: 750 })).toEqual({ price: 750, source: "standard" });
    expect(resolveStartPrice({ walkIn: false, previous: null, list: null, standard: 0 })).toBeNull();
  });
});
