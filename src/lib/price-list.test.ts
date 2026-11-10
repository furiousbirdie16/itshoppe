import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  applyMarkup,
  buildGroupLookup,
  parsePriceCell,
  parsePriceListWorkbook,
  quoteLineName,
  roundUpToTen,
  visiblePriceKeys,
  type PriceGroup,
} from "@/lib/price-list";

function book(sheets: Record<string, unknown[][]>, merges: Record<string, XLSX.Range[]> = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (merges[name]) ws["!merges"] = merges[name];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}

describe("parsePriceCell", () => {
  it("reads numbers and numeric text, rounded to centavos", () => {
    expect(parsePriceCell(1269.2699040000002)).toBe(1269.27);
    expect(parsePriceCell("3,120.36524")).toBe(3120.37);
    expect(parsePriceCell("₱ 550")).toBe(550);
  });
  it("ignores blanks, words and zero", () => {
    expect(parsePriceCell(null)).toBeNull();
    expect(parsePriceCell("TBA")).toBeNull();
    expect(parsePriceCell(0)).toBeNull();
  });
});

describe("parsePriceListWorkbook", () => {
  it("reads a plain sheet and skips group label rows", () => {
    const r = parsePriceListWorkbook(book({
      colorVu: [
        ["Model", "Appearance", "Descriptions", "SDP NEW\r\n(PHP)", "MSRP  NEW\r\n(PHP)"],
        ["DF3T "],
        ["DS-2CE10DF3T-PF", null, "2M BSI CMOS Sensor,Outdoor mini Bullet", 1269.27, 2538.54],
      ],
    }));
    expect(r.rows).toEqual([
      { model: "DS-2CE10DF3T-PF", description: "2M BSI CMOS Sensor,Outdoor mini Bullet", category: "colorVu", sdp: 1269.27, keywords: "" },
    ]);
    expect(r.categories).toEqual(["colorVu"]);
  });

  it("finds headings below a note row and prefers the order model", () => {
    const r = parsePriceListWorkbook(book({
      "1 Series": [
        ["Confidential file only for INTERNAL USE!"],
        ["Basic Model", "Description", "Order Model", "SDP (PHP)", "MSRP (PHP)"],
        ["DS-2CD1047G2", "4MP bullet", "DS-2CD1047G2-LUF", "3120.36", "6240.73"],
      ],
    }));
    expect(r.rows[0].model).toBe("DS-2CD1047G2-LUF");
    expect(r.rows[0].sdp).toBe(3120.36);
  });

  it("copies merged descriptions onto every row they cover", () => {
    const r = parsePriceListWorkbook(
      book({
        S: [
          ["Basic Model", "Description", "Order Model", "SDP", "MSRP"],
          ["DS-1", "4MP warm light", "DS-1-LUF", 100, 200],
          [null, null, "DS-1-L", 90, 180],
        ],
      }, { S: [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }] }),
    );
    expect(r.rows.map((x) => [x.model, x.description])).toEqual([
      ["DS-1-LUF", "4MP warm light"],
      ["DS-1-L", "4MP warm light"],
    ]);
  });

  it("follows headings that come again halfway down, with model after description", () => {
    const r = parsePriceListWorkbook(book({
      Turnstiles: [
        ["Model name", "Picture", "Descriptions"],
        ["DS-K3G501 Series", null, "More than 35 passage frequency"],
        ["Verification Type", "Width", "Type", "Model", "Dealer Price\r\n(PHP Vat-ex)", "MSRP", "Remark"],
        ["card solution", "550mm", "Right", "DS-K3G501CLX-R/Dm55", "48964.5", "97929", "Price increase"],
      ],
    }));
    expect(r.rows).toEqual([
      { model: "DS-K3G501CLX-R/Dm55", description: "card solution · 550mm · Right", category: "Turnstiles", sdp: 48964.5, keywords: "Right" },
    ]);
  });

  it("reports sheets with no prices and keeps a repeated part once", () => {
    const r = parsePriceListWorkbook(book({
      Fiber: [["Model", "Description"], ["FO-1", "patch cord"]],
      LED: [
        ["Models for SPEC", "Description", "Order Module", "Description", "SDP NEW"],
        ["DS-D4009", "Pitch 0.93mm", "DS-D4009/A", "LED module", 20942.15],
        ["DS-D4009", "Pitch 0.93mm", "DS-D40W-2F", "Cabinet", 6326.09],
        ["DS-D4012", "Pitch 1.25mm", "DS-D40W-2F", "Cabinet", 6326.09],
      ],
    }));
    expect(r.skipped).toEqual([{ sheet: "Fiber", reason: "No models with a price" }]);
    expect(r.rows.map((x) => x.model)).toEqual(["DS-D4009/A", "DS-D40W-2F"]);
    expect(r.rows[0].description).toBe("Pitch 0.93mm · LED module");
  });

  it("does not run out of room on a sheet that claims thousands of columns", () => {
    const wb = book({ Wide: [["Model", "SDP"], ["M-1", 10]] });
    wb.Sheets.Wide["!ref"] = "A1:XFA58";
    expect(parsePriceListWorkbook(wb).rows).toHaveLength(1);
  });
});

describe("multi-price lists (TP-Link)", () => {
  const head = ["Image", "Model No.", "Description", "VIP Price \r\nVAT Ex\r\n（PHP）", "Special\r\nDP\r\nVAT Ex", "Bottom Price VAT Ex", "SRP\r\nVAT Ex", "Warranty", "Comment"];
  it("keeps all four prices and takes the category from section rows", () => {
    const r = parsePriceListWorkbook(book({
      "SMB Networking": [
        head,
        ["PoE Switch"],
        [null, "GE POE"],
        [null, "TL-SG1005P", "5-Port Gigabit Desktop Switch with 4-Port PoE+", "1620", "1750", "2490", "2590", "60 months", null],
        [null, "EAP115-Wall", "300Mbps Wall-Plate Access Point", "1100", "1200", "1590", "1690", "24 months", "EOL"],
        [null, "DS-P7001-01", "1-port GPON OLT", "18000", "19800", "26990", "26990", "60 months", "↑"],
      ],
    }));
    expect(r.priceColumns).toEqual(["vip", "dealer", "bottom", "srp"]);
    expect(r.categories).toEqual(["PoE Switch"]);
    expect(r.rows[0]).toEqual({
      model: "TL-SG1005P",
      description: "5-Port Gigabit Desktop Switch with 4-Port PoE+",
      category: "PoE Switch",
      sdp: 1620,
      keywords: "GE POE · SMB Networking",
      prices: { vip: 1620, dealer: 1750, bottom: 2490, srp: 2590 },
      warranty: "60 months",
      tags: [],
    });
    expect(r.rows[1].tags).toEqual(["eol"]);
    expect(r.rows[2].tags).toEqual(["price_up"]);
  });

  it("skips tables of price changes", () => {
    const r = parsePriceListWorkbook(book({
      "SDP Price Changes": [
        ["Model", "New SDP Price", "New SRP", "Previous SDP Price"],
        ["DS-P7001-01", "19800", "26990", "15000"],
      ],
      "VIP Price Changes": [
        ["Model", "New VIP Price", "New Online Bottom Price", "New SRP", "Previous VIP Price"],
        ["DS-P7001-01", "18000", "26990", "26990", "14000"],
      ],
    }));
    expect(r.rows).toEqual([]);
    expect(r.skipped.map((x) => x.sheet)).toEqual(["SDP Price Changes", "VIP Price Changes"]);
  });

  it("shows staff only Bottom and SRP, admins all four", () => {
    const cols = ["vip", "dealer", "bottom", "srp"];
    expect(visiblePriceKeys(cols, true)).toEqual(["vip", "dealer", "bottom", "srp"]);
    expect(visiblePriceKeys(cols, false)).toEqual(["bottom", "srp"]);
  });

  it("leaves one-price lists as they were", () => {
    const r = parsePriceListWorkbook(book({ NVR: [["Model", "Description", "SDP"], ["DS-7608NI", "8-ch", 4783.32]] }));
    expect(r.priceColumns).toEqual([]);
    expect(r.rows[0].prices).toBeUndefined();
  });
});

describe("selling price", () => {
  it("rounds up to the next ten pesos", () => {
    expect(roundUpToTen(1519.27)).toBe(1520);
    expect(roundUpToTen(1520)).toBe(1520);
    expect(roundUpToTen(1520.01)).toBe(1530);
  });
  it("adds a fixed amount or a percent", () => {
    expect(applyMarkup(1269.27, "amount", 250)).toBe(1520);
    expect(applyMarkup(1000, "percent", 15)).toBe(1150);
    // 1.1 * 1000 is 1100.0000000000002 in floating point; still ₱1,100.
    expect(applyMarkup(1000, "percent", 10)).toBe(1100);
  });

  const g = (id: string, name: string, isDefault = false): PriceGroup => ({
    id, brand: "Hikvision", name, markup_type: "amount", markup_value: 0, is_default: isDefault, sort_order: 0,
  });

  it("uses the category's group, then the brand's default", () => {
    const groups = [g("cctv", "CCTV"), g("else", "Everything else", true), { ...g("x", "Other brand"), brand: "Dahua" }];
    const links = [{ id: "1", brand: "hikvision ", category: "colorVu", group_id: "cctv" }];
    const lookup = buildGroupLookup("Hikvision", groups, links);
    expect(lookup("ColorVu")?.id).toBe("cctv");
    expect(lookup("NVR")?.id).toBe("else");
    expect(buildGroupLookup("Uniview", groups, links)("NVR")).toBeNull();
  });
});

describe("quoteLineName", () => {
  it("puts the model first and keeps it short", () => {
    expect(quoteLineName("DS-7608NI-Q1/W", "8-ch camera input, decoding at 8-ch 1080P")).toBe("DS-7608NI-Q1/W - 8-ch camera input");
    expect(quoteLineName("M-1", "")).toBe("M-1");
    expect(quoteLineName("M-1", "x".repeat(200)).length).toBe(90);
  });
});
