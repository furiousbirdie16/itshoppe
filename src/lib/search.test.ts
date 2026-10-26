import { describe, expect, it } from "vitest";
import { normalizeSearch, searchMatches, searchRank } from "./search";

describe("searchMatches", () => {
  it("finds every word in any order, with words in between", () => {
    expect(searchMatches("HDMI 1.5m", "HDMI cable 1.5m")).toBe(true);
    expect(searchMatches("1.5m hdmi", "HDMI cable 1.5m")).toBe(true);
    expect(searchMatches("cat6 copper 305", "CAT6 Pure Copper Indoor 305m")).toBe(true);
  });

  it("needs every word", () => {
    expect(searchMatches("HDMI 3m", "HDMI cable 1.5m")).toBe(false);
  });

  it("takes words from any field", () => {
    expect(searchMatches("netlab cat6", "CAT6 UTP Indoor", "SKU-1", "Netlab")).toBe(true);
  });

  it("treats a space before a unit as none", () => {
    expect(searchMatches("1.5 m", "HDMI cable 1.5m")).toBe(true);
    expect(searchMatches("hdmi 1.5m", "HDMI Cable 1.5 M")).toBe(true);
  });

  it("matches across a hyphen or gap", () => {
    expect(searchMatches("rj45", "RJ-45 Passthrough")).toBe(true);
    expect(searchMatches("rj-45", "RJ45 Passthrough")).toBe(true);
  });

  it("ignores case and accents, and an empty query matches", () => {
    expect(searchMatches("CAFE", "café")).toBe(true);
    expect(searchMatches("   ", "anything")).toBe(true);
  });

  it("keeps a decimal point a decimal point", () => {
    expect(normalizeSearch("1.5m")).toBe("1.5m");
    expect(normalizeSearch("end. Start")).toBe("end start");
  });
});

describe("searchRank", () => {
  it("puts an exact SKU first, then names that start with the query", () => {
    const items = [
      { name: "Cable tie HDMI 1.5m holder", sku: "TIE-1" },
      { name: "HDMI cable 1.5m", sku: "HDMI-15" },
      { name: "Something", sku: "hdmi 1.5m" },
    ];
    const ranked = [...items].sort((a, b) => searchRank("hdmi 1.5m", a.name, a.sku) - searchRank("hdmi 1.5m", b.name, b.sku));
    expect(ranked.map((i) => i.sku)).toEqual(["hdmi 1.5m", "HDMI-15", "TIE-1"]);
  });
});
