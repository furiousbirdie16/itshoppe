import { describe, expect, it } from "vitest";
import { extractSpecs, lensFrom, mpFrom, nightFrom, shapeFrom } from "@/lib/price-specs";

describe("reading single specs", () => {
  it("megapixels in the ways the sheets write them", () => {
    expect(mpFrom("HD1080p")).toBe("2MP");
    expect(mpFrom("8.3MP")).toBe("8MP");
    expect(mpFrom("4K(8MP)")).toBe("8MP");
    expect(mpFrom("4 K")).toBe("8MP");
    expect(mpFrom("25fps/30fps(2688×1520, 1920×1080)")).toBe("4MP");
    expect(mpFrom("2M BSI CMOS Sensor")).toBe("2MP");
    expect(mpFrom("30m IR")).toBeUndefined();
  });
  it("shape, including Hikvision's 'Turrent'", () => {
    expect(shapeFrom("Warm LED Bullet")).toBe("Bullet");
    expect(shapeFrom("ColorVu Lite+MD2.0 13 series Turrent")).toBe("Turret");
    expect(shapeFrom("Outdoor Pan & Tilt camera")).toBe("Pan & tilt");
    expect(shapeFrom("IR Panoramic")).toBe("Fisheye");
  });
  it("lens and night vision", () => {
    expect(lensFrom("2.8/4/6 mm fixed lens")).toBe("2.8/4/6mm");
    expect(lensFrom("2.8-12mm motorized")).toBe("2.8-12mm");
    expect(nightFrom("30m warm light")).toBe("ColorVu 30m");
    expect(nightFrom("Smart hybrid light with IR up to 30m")).toBe("Smart hybrid light 30m");
    expect(nightFrom("20m IR Distance+ IP66")).toBe("IR 20m");
  });
});

describe("extractSpecs", () => {
  it("prefers the sheet's own columns", () => {
    expect(extractSpecs({
      model: "DS-2CE76D0T-EXIPF",
      category: "Eco - Value 2MP",
      description: "2MP CMOS Sensor, 20m IR, Indoor EXIR Turret, 2.8/3.6mm Lens",
      fields: { mp: "HD1080p", shape: "Turret", place: "Indoor", night: "20m IR Distance" },
    })).toMatchObject({ mp: "2MP", shape: "Turret", place: "Indoor", lens: "2.8/3.6mm", night: "IR 20m" });
  });

  it("falls back on the group row, then the model number", () => {
    expect(extractSpecs({ model: "DS-2CD1327G2-LUF", category: "ColorVu 1 Series", description: "4MP", group: "ColorVu Lite+MD2.0 13 series Turrent" }).shape).toBe("Turret");
    expect(extractSpecs({ model: "DS-2CD1127G3-LIUF", category: "ColorVu3.0 1 Series", description: "2MP" }).shape).toBe("Dome");
    expect(extractSpecs({ model: "DS-2CD1T27G3-LIUF", category: "ColorVu3.0 1 Series", description: "2MP" }).shape).toBe("Turret");
    expect(extractSpecs({ model: "HWI-D121H(C)", category: "HIWATCH", description: "1/2.8\" Progressive CMOS, 1920x1080" })).toMatchObject({ mp: "2MP", shape: "Dome" });
  });

  it("reads indoor/outdoor from an IP rating, else from the shape", () => {
    expect(extractSpecs({ model: "DS-2CD1027G3-LIUF", category: "ColorVu3.0 1 Series", description: "x", fields: { place: "IP67" } }).place).toBe("Outdoor");
    expect(extractSpecs({ model: "HWI-D121H(C)", category: "HIWATCH", description: "x" }).place).toBe("Indoor");
  });

  it("gives recorders channels and kits their model's numbers", () => {
    expect(extractSpecs({ model: "DS-7208HGHI-M1", category: "AcuSense DVR", description: "8-ch HDTVI input" })).toMatchObject({ channels: "8ch" });
    expect(extractSpecs({ model: "HWN-2104MH", category: "HIWATCH", description: "" }).channels).toBe("4ch");
    expect(extractSpecs({ model: "TVI-4CH2D2B-2MP-Eco", category: "Analog KIT", description: "" })).toMatchObject({ mp: "2MP", channels: "4ch" });
  });

  it("leaves non-cameras without camera specs", () => {
    const deco = extractSpecs({ model: "Deco BE85(3-pack)", category: "Whole-Home Wi-Fi System", description: "BE22000 Mesh Wi-Fi 7 System, 4K-QAM, 320MHz" });
    expect(deco.mp).toBeUndefined();
    expect(deco.shape).toBeUndefined();
    expect(extractSpecs({ model: "DS-3E1510P-EI", category: "Smart CCTV Networking", description: "8 10/100M RJ45 PoE ports" }).mp).toBeUndefined();
  });
});
