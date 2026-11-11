/**
 * Searching a price list the way customers ask.
 *
 * Customers say "8ch DVR" or "2mp indoor analog". The Hikvision list never
 * says "DVR" in a description (only in the sheet name), writes "8-ch", writes
 * "2M" or "HD1080p", and never says "analog". So each model gets a search
 * text made when the list is uploaded: its model, sheet name and description,
 * with spellings made the same ("8-ch" → "8ch", "2M" → "2mp") and words
 * added from the model number (DS-2CE is an analog camera, DS-2CD an IP
 * camera, DS-72xxH a DVR, DS-76xxN an NVR). A search is put through the same
 * rules, so both sides meet in the middle.
 */

/** Lower case, spellings made the same, punctuation turned into spaces. */
export function normalizeSearch(text: string): string {
  return ` ${text} `
    .toLowerCase()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/wi-?fi/g, "wifi")
    .replace(/turbo\s*hd/g, "turbohd")
    // "8-ch", "8 ch", "8 channel", "8-channels" → "8ch"
    .replace(/(\d+)\s*-?\s*(?:ch|channels?)\b/g, "$1ch")
    // "2 MP", "2-megapixel", "2 mega pixels" → "2mp"
    .replace(/(\d+(?:\.\d+)?)\s*-?\s*(?:mp|megapixels?|mega\s*pixels?)\b/g, "$1mp")
    // A bare "2M" is megapixels only for camera sizes; "20m" / "30M" are IR
    // distances and stay as they are.
    .replace(/\b(1|2|3|4|5|6|8|12)\s*m\b/g, "$1mp")
    // "8-Port", "8 port", "8 ports" → "8port"
    .replace(/(\d+)\s*-?\s*ports?\b/g, "$1port")
    // Wi-Fi generations: "Wi-Fi 7" / "wifi7" / BE22000 are all wifi7.
    .replace(/wifi\s*-?\s*(\d)(e?)\b/g, "wifi$1$2")
    .replace(/\bbe\d{4,5}\b/g, "$& wifi7")
    .replace(/\bax\d{3,5}\b/g, "$& wifi6")
    .replace(/\bac\d{3,4}\b/g, "$& wifi5")
    .replace(/\bpoe\s*\+/g, "poe poeplus")
    // Customers say 2MP for 1080p and 8MP for 4K.
    .replace(/\b1080p\b/g, "1080p 2mp")
    .replace(/\b4k\b/g, "4k 8mp")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(^|\s)\.+|\.+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words a model number stands for. Hikvision only for now: another brand's
 * codes mean nothing here, and its products are found by their own words.
 */
export function modelTags(model: string, category = ""): string[] {
  const m = model.trim().toUpperCase();
  const cat = category.toLowerCase();
  const tags: string[] = [];
  if (/^DS-2CE/.test(m)) tags.push("analog", "turbohd", "camera");
  else if (/^DS-2C[DV]/.test(m)) tags.push("ip", "network", "camera");
  // Network switches: their descriptions never say "switch" ("L2, Smart
  // Managed, 8 10/100M RJ45 PoE ports").
  else if (/^DS-3[ET]\d/.test(m)) tags.push("switch", "network");
  // HiWatch, Hikvision's value line, numbers its own way: HWI- IP camera,
  // HWT- analog camera, HWN- NVR, HWD- DVR.
  else if (/^(?:E-)?HWI/.test(m)) tags.push("ip", "network", "camera", "hiwatch");
  else if (/^HWT/.test(m)) tags.push("analog", "turbohd", "camera", "hiwatch");
  if (/^HWN-/.test(m)) tags.push("nvr", "ip", "recorder", "hiwatch");
  if (/^HWD-/.test(m)) tags.push("dvr", "analog", "recorder", "hiwatch");
  const hw = m.match(/^HW[ND]-\d{2}(\d{2})/);
  if (hw) tags.push(`${Number(hw[1])}ch`);
  // Kits are cameras with a recorder, sold as one.
  if (/\bkit\b/.test(cat)) tags.push("kit", "camera");

  // Recorders: the two digits after DS-72 / DS-76 are the channel count
  // (DS-7208HGHI is an 8-channel DVR, DS-7616NI a 16-channel NVR).
  const rec = m.match(/^I?DS-(7[1-9]|9[0-9])(\d{2})([A-Z])/);
  const isDvr = (rec && rec[3] === "H") || /\bdvr\b/.test(cat);
  const isNvr = (rec && rec[3] === "N") || /\bnvr\b/.test(cat);
  if (isDvr) tags.push("dvr", "analog", "recorder");
  else if (isNvr) tags.push("nvr", "ip", "recorder");
  if (rec && (isDvr || isNvr)) tags.push(`${Number(rec[2])}ch`);
  return tags;
}

/**
 * Megapixels from the largest resolution written ("2688×1520, 1920×1080" →
 * "4mp"). Only the largest: the smaller ones are sub-streams, and a 4MP
 * camera should not turn up for "2mp".
 */
export function resolutionTag(text: string): string | null {
  let best = 0;
  for (const m of text.matchAll(/(\d{3,4})\s*[x×*]\s*(\d{3,4})/gi)) {
    const px = Number(m[1]) * Number(m[2]);
    if (px > best) best = px;
  }
  if (best < 600_000) return null;
  return `${Math.round(best / 1_000_000)}mp`;
}

/** The text stored with each model for searching. */
export function buildSearchText(model: string, category: string, description: string, keywords = "", specs: Record<string, string | undefined> = {}): string {
  const key = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  const res = resolutionTag(`${keywords} ${description}`) ?? "";
  // The specs too, so "indoor dome" finds a dome whose description never
  // says either word.
  const spec = Object.values(specs).filter(Boolean).join(" ");
  return normalizeSearch(`${model} ${key} ${modelTags(model, category).join(" ")} ${category} ${keywords} ${spec} ${res} ${description}`);
}

// Words that say nothing about the product. Includes the Taglish ones a
// customer's message is often pasted with.
const FILLER = new Set([
  "do", "you", "have", "has", "any", "the", "a", "an", "for", "with", "of", "and", "or", "in", "on",
  "i", "we", "need", "want", "looking", "price", "prices", "how", "much", "is", "are", "there", "pls",
  "please", "can", "get", "available", "stock", "po", "ba", "kayo", "meron", "may", "yung", "ng", "sa",
  "na", "pa", "ano", "magkano", "hm", "pcs", "pc", "unit", "units",
]);

// A word on the left also finds the words on the right.
const SYNONYMS: Record<string, string[]> = {
  analog: ["analog", "turbohd", "tvi"],
  analogue: ["analog", "turbohd", "tvi"],
  hd: ["hd", "turbohd"],
  ip: ["ip", "network"],
  cam: ["camera"],
  cams: ["camera"],
  camera: ["camera"],
  cameras: ["camera"],
  cctv: ["camera"],
  dome: ["dome", "turret"],
  turret: ["turret", "dome"],
  bullet: ["bullet"],
  wireless: ["wireless", "wifi"],
  wifi: ["wifi", "wireless"],
  recorder: ["recorder", "dvr", "nvr"],
  mesh: ["mesh", "deco"],
  deco: ["deco", "mesh"],
  router: ["router"],
  routers: ["router"],
  switches: ["switch"],
  extender: ["extender", "repeater"],
  repeater: ["repeater", "extender"],
  ap: ["ap", "access"],
};

/** Sizes and generations ("8port", "16ch", "4mp", "wifi7") match whole words only. */
const SIZE_WORD = /^(\d+(ch|mp|port)|wifi\d+e?)$/;

export interface SearchTerm {
  /** Words that count as a match, already normalized. */
  alternatives: string[];
  /** Model-number fragments ("7608ni") match anywhere, not only at a word start. */
  anywhere: boolean;
}

export function parseSearchQuery(query: string): SearchTerm[] {
  const words = normalizeSearch(query).split(" ").filter((w) => w && !FILLER.has(w));
  const terms: SearchTerm[] = [];
  for (const w of [...new Set(words)].slice(0, 8)) {
    const looksLikeModel = w.length >= 4 && /\d/.test(w) && !SIZE_WORD.test(w);
    terms.push({
      alternatives: SYNONYMS[w] ?? [w],
      anywhere: looksLikeModel,
    });
  }
  return terms;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One Postgres regular expression per term; a model must match all of them.
 * `\m` is Postgres for "start of a word", so "8ch" does not match "128ch"
 * while "bull" still finds "bullet".
 */
export function termToPattern(t: SearchTerm): string {
  // A model fragment is also tried without its dots ("2.8" → "28").
  const words = t.anywhere
    ? [...t.alternatives, ...t.alternatives.map((a) => a.replace(/[^a-z0-9]/g, ""))]
    : t.alternatives;
  const unique = [...new Set(words.filter(Boolean))];
  if (t.anywhere) {
    const alts = unique.map(escapeRegex);
    return alts.length === 1 ? alts[0] : `(${alts.join("|")})`;
  }
  // Short words and sizes must be the whole word: "ip" is not the start of
  // "IP67" (a waterproof rating on analog cameras), "8ch" is not "8chs".
  // Longer words may be the start of one, so "bull" finds "bullet".
  const alts = unique.flatMap((a) => {
    // "8port" also finds "8 10/100M RJ45 PoE ports" and "4× Gigabit PoE+
    // Ports": the count can sit a few words before the word port.
    const ports = a.match(/^(\d+)port$/);
    if (ports) return [`${ports[1]}port\\M`, `${ports[1]}(\\s+\\S+){0,5}\\s+ports?\\M`];
    return [a.length <= 3 || SIZE_WORD.test(a) ? `${escapeRegex(a)}\\M` : escapeRegex(a)];
  });
  const body = alts.length === 1 ? alts[0] : `(${alts.join("|")})`;
  return `\\m${body}`;
}

/**
 * Orders matches so the obvious answer comes first: terms found in the model,
 * its tags or the sheet name count more than ones buried in a long
 * description. "8ch DVR" puts the 8-channel DVRs above 16-channel ones that
 * mention "8-ch IP input".
 */
export function rankMatches<T extends { model: string; category: string; description: string }>(rows: T[], terms: SearchTerm[]): T[] {
  if (terms.length === 0) return rows;
  const scored = rows.map((r, i) => {
    // The description's opening words are its headline on lists like
    // TP-Link's ("Omada 8-Port Gigabit Smart Switch", "VIGI 64 Channel NVR").
    const headline = r.description.split(/\b(?:SPEC|PORT|SPEED|FEATURE)\s*:|[;,]/)[0].slice(0, 80);
    const head = ` ${normalizeSearch(`${r.model} ${r.model.toLowerCase().replace(/[^a-z0-9]/g, "")} ${modelTags(r.model, r.category).join(" ")} ${r.category} ${headline}`)} `;
    let score = 0;
    for (const t of terms) {
      if (t.alternatives.some((a) => (t.anywhere ? head.includes(a) : SIZE_WORD.test(a) || a.length <= 3 ? head.includes(` ${a} `) : head.includes(` ${a}`)))) score++;
    }
    return { r, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.r);
}
