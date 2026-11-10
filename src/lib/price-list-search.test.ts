import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  modelTags,
  normalizeSearch,
  resolutionTag,
  parseSearchQuery,
  rankMatches,
  termToPattern,
} from "@/lib/price-list-search";

/** What Postgres would do with the patterns: every term must match. */
function matches(query: string, model: string, category: string, description: string): boolean {
  const text = buildSearchText(model, category, description);
  return parseSearchQuery(query).every((t) => new RegExp(termToPattern(t).replace(/\\[mM]/g, "\\b"), "i").test(text));
}

const DVR = ["DS-7208HGHI-M1", "AcuSense DVR", "full-channel motion detection 2.0 ,8 Turbo HD/AHD/Analog interface input,8-ch HDTVI coaxial video&audio input"] as const;
const DVR16 = ["DS-7216HGHI-M1", "AcuSense DVR", "16 Turbo HD/AHD/Analog interface input,16-ch HDTVI coaxial video&audio input, 8-ch IP video input"] as const;
const DVR128 = ["DS-9128HQHI-K8", "Pro DVR", "128-ch IP video input"] as const;
const TURRET = ["DS-2CE70DF3T-PF", "colorVu", "2M BSI CMOS Sensor,Indoor Turret,0.0005Lux/F1.0, 0 Lux with Friendly Lighting,20M,3D DNR"] as const;
const IP_TURRET = ["DS-2CD1327G2-LUF", "ColorVu 1 Series", "2MP indoor turret, H.265+, PoE"] as const;
const NVR = ["DS-7608NI-Q1/W", "NVR", "8-ch camera input, decoding capability at 8-ch 1080P, Supporting Wi-Fi6 connection"] as const;

describe("normalizeSearch", () => {
  it("makes channel and megapixel spellings the same", () => {
    expect(normalizeSearch("8-ch, 8 ch, 8 channels")).toBe("8ch 8ch 8ch");
    expect(normalizeSearch("2M BSI, 2 MP, 2-megapixel")).toBe("2mp bsi 2mp 2mp");
  });
  it("leaves IR distances alone and reads 1080p and 4K as megapixels", () => {
    expect(normalizeSearch("20M IR, 30m")).toBe("20m ir 30m");
    expect(normalizeSearch("HD1080p")).toBe("hd1080p");
    expect(normalizeSearch("1080P lite")).toBe("1080p 2mp lite");
    expect(normalizeSearch("4K HDMI")).toBe("4k 8mp hdmi");
  });
});

describe("modelTags", () => {
  it("reads the kind of product from a Hikvision model number", () => {
    expect(modelTags("DS-2CE70DF3T-PF")).toEqual(["analog", "turbohd", "camera"]);
    expect(modelTags("DS-2CD2047G2-L (C)")).toEqual(["ip", "network", "camera"]);
    expect(modelTags("iDS-7208HQHI-M1/E")).toEqual(["dvr", "analog", "recorder", "8ch"]);
    expect(modelTags("DS-7616NI-Q2")).toEqual(["nvr", "ip", "recorder", "16ch"]);
    expect(modelTags("DS-K1T502DBWX-C")).toEqual([]);
  });
  it("falls back on the sheet name", () => {
    expect(modelTags("XYZ-100", "Pro DVR")).toEqual(["dvr", "analog", "recorder"]);
  });
});

describe("customer searches", () => {
  it("finds an 8-channel DVR from '8ch DVR' and the whole question", () => {
    expect(matches("8ch DVR", ...DVR)).toBe(true);
    expect(matches("do you have 8ch DVR?", ...DVR)).toBe(true);
    expect(matches("8 channel dvr", ...DVR)).toBe(true);
    expect(matches("8ch DVR", ...NVR)).toBe(false);
  });
  it("does not let 8ch match 128-ch", () => {
    expect(matches("8ch", ...DVR128)).toBe(false);
  });
  it("finds a 2MP indoor analog camera, not the IP one", () => {
    expect(matches("2mp indoor analog", ...TURRET)).toBe(true);
    expect(matches("2mp indoor analog", ...IP_TURRET)).toBe(false);
    expect(matches("2mp indoor ip camera", ...IP_TURRET)).toBe(true);
    expect(matches("2mp dome", ...TURRET)).toBe(true);
  });
  it("does not read IP67 as an IP camera", () => {
    expect(matches("ip camera", "DS-2CE16D0T-EXIPF", "Eco - Value 2MP", "Outdoor EXIR Bullet, IP66")).toBe(false);
  });
  it("still finds a model number however it is typed", () => {
    expect(matches("7608NI", ...NVR)).toBe(true);
    expect(matches("DS-7608NI-Q1/W", ...NVR)).toBe(true);
    expect(matches("2047g2lc", "DS-2CD2047G2-L (C)", "EasyIP", "")).toBe(true);
    expect(matches("bull", "DS-2CE16D0T", "Eco", "Outdoor Bullet")).toBe(true);
  });
  it("finds wifi however it is written", () => {
    expect(matches("wifi nvr", ...NVR)).toBe(true);
    expect(matches("wireless nvr", ...NVR)).toBe(true);
  });
});

describe("IP cameras from their own columns", () => {
  it("reads megapixels from the largest resolution only", () => {
    expect(resolutionTag("25fps/30fps(2688×1520, 1920×1080)")).toBe("4mp");
    expect(resolutionTag("3840x2160")).toBe("8mp");
    expect(resolutionTag("no resolution here")).toBeNull();
  });
  it("finds a 4MP IP turret by its form factor and resolution", () => {
    const desc = "1/3\" Progressive Scan CMOS; H.265+; 25fps/30fps(2688×1520, 1920×1080)";
    const text = buildSearchText("DS-2CD2343G2-IU", "IPC-EasyIP 2.0+ Acusense", desc, "Turret · 4MP");
    const ok = (q: string) => parseSearchQuery(q).every((t) => new RegExp(termToPattern(t).replace(/\\[mM]/g, "\\b"), "i").test(text));
    expect(ok("4mp ip dome")).toBe(true);
    expect(ok("4mp ip turret")).toBe(true);
    expect(ok("2mp ip turret")).toBe(false);
  });
});

describe("rankMatches", () => {
  it("puts the 8-channel DVR above a 16-channel one that mentions 8-ch", () => {
    const rows = [DVR16, DVR].map(([model, category, description]) => ({ model, category, description }));
    expect(rankMatches(rows, parseSearchQuery("8ch dvr")).map((r) => r.model)).toEqual(["DS-7208HGHI-M1", "DS-7216HGHI-M1"]);
  });
});
