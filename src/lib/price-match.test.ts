import { describe, expect, it } from "vitest";
import { bestMatches, confidence, nameScore, nameTokens } from "@/lib/price-match";

describe("nameTokens", () => {
  it("keeps sizes together, drops their unit and order", () => {
    expect(nameTokens("80x50mm junction box")).toEqual(["50x80", "junction"]);
    expect(nameTokens("JUNCTION BOX 80 X 50 MM")).toEqual(["junction", "50x80"]);
    expect(nameTokens("Cat6 Indoor 305 meters")).toEqual(["cat6", "indoor", "305m"]);
  });
  it("reads a cabinet's Width / Height / Depth as one size", () => {
    expect(nameTokens("Data Cabinet 12u Width: 530mm Height: 600mm Depth :400mm")).toEqual(["data", "cabinet", "12u", "400x530x600"]);
  });
  it("leaves pack sizes out and splits numbers stuck to words", () => {
    expect(nameTokens("Cable Clip 8mm (per pack 100 pcs)")).toEqual(["cable", "clip", "8mm"]);
    expect(nameTokens("POE SWITCH 8 + 2 + 1SFP")).toEqual(["poe", "switch", "8", "2", "1", "sfp"]);
  });
});

describe("nameScore", () => {
  it("scores the same product written differently high", () => {
    expect(nameScore("80x50mm junction box", "JUNCTION BOX 80X50")).toBeGreaterThanOrEqual(0.9);
    expect(nameScore("2 meters cable tray 30x30mm (HxW)", "Cable tray 30x30mm")).toBeGreaterThanOrEqual(0.8);
  });
  it("scores a different size low even with the same words", () => {
    expect(nameScore("80x50mm junction box", "JUNCTION BOX 100X100X70")).toBeLessThan(0.45);
    expect(nameScore("2 meters cable tray 30x30mm", "Cable tray 50x50mm")).toBeLessThan(0.45);
  });
});

describe("bestMatches and confidence", () => {
  const items = [
    { id: "a", name: "Junction Box 100x100x70", sku: "" },
    { id: "b", name: "Junction Box Circle", sku: "" },
    { id: "c", name: "Data Cabinet 12u 530x400x600", sku: "" },
    { id: "d", name: "Data Cabinet 4U 530x240x400", sku: "" },
    { id: "e", name: "HDMI Cable 30m", sku: "" },
    { id: "f", name: "HDMI Extender 30m", sku: "" },
  ];
  it("finds a cabinet whose size is written in another order", () => {
    const [m] = bestMatches("Data Cabinet 12u w/ shelf Width: 530mm Height: 600mm Depth :400mm", items);
    expect(m.item.id).toBe("c");
  });
  it("honours a telling word like 'circle'", () => {
    expect(bestMatches("100x100x70mm junction box (circle)", items)[0].item.id).toBe("b");
    expect(bestMatches("100x100x70mm junction box", items)[0].item.id).toBe("a");
  });
  it("never calls a near-tie close", () => {
    const [a, b] = bestMatches("HDMI 30M", items, 2);
    expect(confidence(a.score, b.score)).not.toBe("high");
    const [c, d] = bestMatches("Data Cabinet 4U w/ shelf Width: 530mm Height: 240mm Depth :400mm", items, 2);
    expect(confidence(c.score, d?.score ?? 0)).toBe("high");
  });
});
