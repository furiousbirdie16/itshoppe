import * as XLSX from "xlsx";

/**
 * Supplier price lists, kept apart from inventory.
 *
 * A supplier's Excel price list (Hikvision sends one with 80-odd sheets) is
 * read into plain rows: model, description, category and SDP. Nothing
 * here touches stock; a model only becomes an inventory item when someone
 * adds it on purpose.
 *
 * The sheets do not share a layout. The model column is called "Model",
 * "Order Model", "Product Model" or "Models for SPEC"; the dealer price is
 * "SDP NEW (PHP)", "最新SDP" or "Dealer Price"; some sheets put a note above
 * the headings, some repeat the headings halfway down, and merged cells leave
 * a description on the first row of a group only. The reader copes with all
 * of that and reports the sheets it could not use.
 */

export interface ParsedPriceRow {
  model: string;
  description: string;
  category: string;
  sdp: number;
  /**
   * Shape, resolution, indoor/outdoor and the like from their own columns
   * ("Turret · 4MP · Indoor"). Kept for searching only: IP camera
   * descriptions never say "bullet" or "4MP", these columns do.
   */
  keywords: string;
}

export interface ParsedPriceList {
  rows: ParsedPriceRow[];
  /** Sheets that held no priced models, with the reason. */
  skipped: { sheet: string; reason: string }[];
  categories: string[];
}

type Cell = unknown;

const clean = (v: Cell): string =>
  v == null ? "" : String(v).replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/\s+/g, " ").trim();

/** A price cell as a number, or null when it is blank, text or zero. */
export function parsePriceCell(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[₱,\s]/g, "").replace(/^php/i, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

// Header names, most specific first. The orderable code beats the family name
// ("Order Model" DS-2CD1047G2-LUF over "Basic Model" DS-2CD1047G2).
const MODEL_HEADERS: RegExp[] = [
  /^orders? (model|module)$/,
  /^(product )?model( name)?s?$/,
  /^models? for spec/,
  /^basic model$/,
];
const PRICE_HEADER = /sdp|dealer price/;
// MSRP is not kept; the column is found only so it never ends up in a
// description.
const MSRP_HEADER = /msrp/;
const DESC_HEADER = /desc/;
const NOISE_HEADER = /remark|note|status|picture|image|appearance|sap|bom|certific|firmware|^no\.?$/;
const KEYWORD_HEADER = /form factor|resolution|indoor|outdoor|^type$|features?|lens|offering level/;

interface Columns {
  model: number;
  sdp: number;
  msrp: number;
  desc: number[];
  /** Columns that never describe a model: notes, codes, pictures. */
  noise: Set<number>;
  keywords: number[];
}

/** Column positions if this row is a heading row, else null. */
function readHeader(row: Cell[]): Columns | null {
  const h = row.map((c) => clean(c).toLowerCase());
  // Long sentences ("If the pre-sets match your project need … choose proper
  // model") are notes, not headings.
  const isHead = (s: string) => s.length > 0 && s.length <= 40;
  let model = -1;
  for (const re of MODEL_HEADERS) {
    model = h.findIndex((s) => isHead(s) && re.test(s));
    if (model >= 0) break;
  }
  const sdp = h.findIndex((s) => isHead(s) && PRICE_HEADER.test(s));
  if (model < 0 || sdp < 0) return null;
  const msrp = h.findIndex((s) => isHead(s) && MSRP_HEADER.test(s));
  const desc: number[] = [];
  h.forEach((s, i) => {
    if (isHead(s) && DESC_HEADER.test(s)) desc.push(i);
  });
  const noise = new Set<number>();
  h.forEach((s, i) => {
    if (NOISE_HEADER.test(s)) noise.add(i);
  });
  const keywords: number[] = [];
  h.forEach((s, i) => {
    if (isHead(s) && KEYWORD_HEADER.test(s) && i !== model && !desc.includes(i) && !noise.has(i)) keywords.push(i);
  });
  return { model, sdp, msrp, desc, noise, keywords };
}

/** Copy each merged cell's value into every cell it covers. */
function fillMerges(ws: XLSX.WorkSheet) {
  for (const m of ws["!merges"] ?? []) {
    const top = ws[XLSX.utils.encode_cell(m.s)];
    if (!top) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        ws[XLSX.utils.encode_cell({ r, c })] = { ...top };
      }
    }
  }
}

/**
 * Shrink the sheet's range to the cells that hold something. Some sheets in
 * the Hikvision file claim 16,000 columns (A1:XFA58), and reading every row
 * out to that width runs the browser out of memory.
 */
function trimRange(ws: XLSX.WorkSheet) {
  let maxR = -1;
  let maxC = -1;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;
    const cell = ws[addr] as XLSX.CellObject;
    if (cell?.v == null || cell.v === "") continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) {
    ws["!ref"] = "A1:A1";
    ws["!merges"] = [];
    return;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  ws["!merges"] = (ws["!merges"] ?? [])
    .filter((m) => m.s.r <= maxR && m.s.c <= maxC)
    .map((m) => ({ s: m.s, e: { r: Math.min(m.e.r, maxR), c: Math.min(m.e.c, maxC) } }));
}

export function parsePriceListSheet(ws: XLSX.WorkSheet, sheetName: string): ParsedPriceRow[] {
  trimRange(ws);
  fillMerges(ws);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false, defval: null, raw: true });
  const category = clean(sheetName);
  const out: ParsedPriceRow[] = [];
  const seen = new Set<string>();
  let cols: Columns | null = null;

  for (const row of rows) {
    // Headings can come again halfway down a sheet with different columns.
    const head = readHeader(row);
    if (head) {
      cols = head;
      continue;
    }
    if (!cols) continue;
    const model = clean(row[cols.model]);
    const sdp = parsePriceCell(row[cols.sdp]);
    // Group labels ("DF3T", "Pro Series: …") have no price and drop out here.
    if (!model || sdp == null) continue;

    let description: string;
    if (cols.desc.length > 0) {
      const parts = cols.desc.map((i) => clean(row[i])).filter(Boolean);
      description = [...new Set(parts)].join(" · ");
    } else {
      // No description column (turnstile presets): the row's other words
      // ("550mm · Right") are what tell one model from the next.
      const skip = new Set([cols.model, cols.sdp, cols.msrp, ...cols.noise]);
      description = row
        .map((c, i) => (skip.has(i) || typeof c === "number" ? "" : clean(c)))
        .filter(Boolean)
        .join(" · ");
    }

    // One sheet can list the same part several times (an LED cabinet frame
    // under every module). Same model at the same price is one row.
    const key = `${model.toLowerCase()}|${sdp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const keywords = [...new Set(cols.keywords.map((i) => clean(row[i])).filter(Boolean))].join(" · ");
    out.push({ model, description, category, sdp, keywords });
  }
  return out;
}

export function parsePriceListWorkbook(wb: XLSX.WorkBook): ParsedPriceList {
  const rows: ParsedPriceRow[] = [];
  const skipped: ParsedPriceList["skipped"] = [];
  const categories: string[] = [];
  for (const name of wb.SheetNames) {
    const sheetRows = parsePriceListSheet(wb.Sheets[name], name);
    if (sheetRows.length === 0) {
      skipped.push({ sheet: clean(name), reason: "No models with a price" });
      continue;
    }
    categories.push(clean(name));
    rows.push(...sheetRows);
  }
  return { rows, skipped, categories };
}

export function readPriceListFile(data: ArrayBuffer): ParsedPriceList {
  return parsePriceListWorkbook(XLSX.read(data, { type: "array" }));
}

// ---------------------------------------------------------------------------
// Selling price
// ---------------------------------------------------------------------------

export type MarkupType = "amount" | "percent";

export interface PriceGroup {
  id: string;
  brand: string;
  name: string;
  markup_type: MarkupType;
  markup_value: number;
  is_default: boolean;
  sort_order: number;
}

export interface PriceGroupCategory {
  id: string;
  brand: string;
  category: string;
  group_id: string;
}

/** Round up to the next ₱10: ₱1,519.27 → ₱1,520, ₱1,520 stays ₱1,520. */
export function roundUpToTen(n: number): number {
  const cents = Math.round(n * 100);
  return Math.ceil(cents / 1000) * 10;
}

export function applyMarkup(sdp: number, type: MarkupType, value: number): number {
  const raw = type === "percent" ? sdp * (1 + value / 100) : sdp + value;
  return roundUpToTen(raw);
}

export function describeMarkup(type: MarkupType, value: number): string {
  if (type === "percent") return `SDP + ${value}%`;
  return `SDP + ₱${value.toLocaleString("en-PH")}`;
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Finds the group each category belongs to for one brand. A category nobody
 * has sorted falls to the brand's default group ("Everything else").
 */
export function buildGroupLookup(brand: string, groups: PriceGroup[], links: PriceGroupCategory[]) {
  const mine = groups.filter((g) => key(g.brand) === key(brand));
  const byId = new Map(mine.map((g) => [g.id, g]));
  const byCategory = new Map<string, PriceGroup>();
  for (const l of links) {
    if (key(l.brand) !== key(brand)) continue;
    const g = byId.get(l.group_id);
    if (g) byCategory.set(key(l.category), g);
  }
  const fallback = mine.find((g) => g.is_default) ?? null;
  return (category: string): PriceGroup | null => byCategory.get(key(category)) ?? fallback;
}

/** Selling price for a row, or null when the brand has no groups at all. */
export function sellingPrice(sdp: number, group: PriceGroup | null): number | null {
  if (!group) return null;
  return applyMarkup(sdp, group.markup_type, Number(group.markup_value));
}

/** The name a quotation line gets: the model, then the start of its description. */
export function quoteLineName(model: string, description: string, max = 90): string {
  const d = description.split(/[,;·]/)[0]?.trim() ?? "";
  if (!d) return model;
  const name = `${model} - ${d}`;
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}
