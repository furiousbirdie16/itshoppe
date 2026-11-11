/**
 * The handful of specs people actually choose a camera by — megapixels,
 * shape, indoor or outdoor, lens, night vision — pulled out of a price list
 * row so they can be columns and filters instead of a wall of description.
 *
 * Each comes from the sheet's own column when it has one ("Form Factor",
 * "Indoor/ Outdoor", "Max Resolution", "Lens"), else from the description
 * ("Indoor Turret", "2560×1440", "2.8/4mm"), else from the model number
 * (HiWatch HWI-B… is a bullet). Some stay blank when nothing says.
 */

export type SpecKey = "mp" | "shape" | "place" | "lens" | "night" | "channels" | "extras";

export interface Specs {
  mp?: string;
  shape?: string;
  place?: string;
  lens?: string;
  night?: string;
  channels?: string;
  extras?: string;
}

/** Sheet columns that hold a spec, by heading. */
export const SPEC_HEADERS: { key: Exclude<SpecKey, "channels" | "extras">; header: RegExp }[] = [
  { key: "mp", header: /resolution/ },
  { key: "shape", header: /form factor/ },
  { key: "place", header: /indoor|outdoor|protection|ipxx/ },
  { key: "lens", header: /lens/ },
  { key: "night", header: /^ir\b|^features?$/ },
];

/** Megapixels from text: "5MP", "8.3MP", "4K(8MP)", "HD1080p", "2560×1440". */
export function mpFrom(text: string): string | undefined {
  const t = text.toLowerCase();
  let best = 0;
  for (const m of t.matchAll(/(\d{3,4})\s*[x×*]\s*(\d{3,4})/g)) best = Math.max(best, Number(m[1]) * Number(m[2]));
  if (best >= 600_000) return `${Math.round(best / 1_000_000)}MP`;
  const mp = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:mp\b|megapixel|mega pixel)/);
  if (mp) return `${Math.round(Number(mp[1]))}MP`;
  if (/\b4\s*k\b|2160p/.test(t)) return "8MP";
  if (/1080p/.test(t)) return "2MP";
  if (/720p/.test(t)) return "1MP";
  // Hikvision's own shorthand at the start of a description: "2M BSI CMOS".
  // Only camera sizes: "20m" / "30m" are IR distances.
  const m = t.match(/^\s*(1|2|3|4|5|6|8|12)\s*m\b(?!\s*(?:ir|exir|warm|white))/);
  if (m) return `${Number(m[1])}MP`;
  return undefined;
}

export function shapeFrom(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\bptz\b|speed dome/.test(t)) return "PTZ";
  if (/\bpt turret|pan\s*(&|and|\/)?\s*tilt/.test(t)) return "Pan & tilt";
  if (/fisheye|panoramic/.test(t)) return "Fisheye";
  // Hikvision's own sheets spell it "Turrent" now and then.
  if (/turr?ett?|turrent|eyeball/.test(t)) return "Turret";
  if (/\bdome\b/.test(t)) return "Dome";
  if (/bullet/.test(t)) return "Bullet";
  if (/\bcube\b/.test(t)) return "Cube";
  return undefined;
}

export function placeFrom(text: string): string | undefined {
  const t = text.toLowerCase();
  const indoor = /\bindoor\b/.test(t);
  const outdoor = /\boutdoor\b/.test(t);
  if (indoor && outdoor) return "Indoor/Outdoor";
  if (indoor) return "Indoor";
  if (outdoor) return "Outdoor";
  return undefined;
}

export function lensFrom(text: string): string | undefined {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (/360\s*°?\s*fisheye|fisheye lens/.test(t)) return "Fisheye";
  const range = t.match(/(\d+(?:\.\d+)?)\s*(?:-|~|to)\s*(\d+(?:\.\d+)?)\s*mm/);
  if (range) return `${range[1]}-${range[2]}mm`;
  const fixed = t.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s*mm/);
  if (fixed) return `${fixed[1].replace(/\s+/g, "")}mm`;
  return undefined;
}

export function nightFrom(text: string): string | undefined {
  const t = text.toLowerCase();
  const dist =
    t.match(/(\d+)\s*m\s*(?:ex)?ir\b/) ??
    t.match(/\bir\b[^0-9]{0,20}(\d+)\s*m\b/) ??
    t.match(/(\d+)\s*m\s*(?:warm|white)/) ??
    t.match(/(?:warm|white)[^0-9]{0,20}(\d+)\s*m\b/);
  const d = dist ? ` ${dist[1]}m` : "";
  if (/smart hybrid|hybrid light|hybird light|hybrid-light/.test(t)) return `Smart hybrid light${d}`;
  if (/colorvu|full\s*time colou?r|24\/7 colou?r|24h colou?r|warm (?:led|light)|white light|full-colou?r/.test(t)) return `ColorVu${d}`;
  if (/\b(?:ex)?ir\b|infrared/.test(t)) return `IR${d}`;
  return undefined;
}

export function extrasFrom(text: string, isCamera: boolean): string | undefined {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/two-?way audio/.test(t)) out.push("Two-way audio");
  else if (/built-?in mic|microphone|mic\b/.test(t)) out.push("Mic");
  if (/acusense/.test(t)) out.push("AcuSense");
  if (/strobe/.test(t)) out.push("Strobe");
  if (isCamera && /\bpoe\b/.test(t)) out.push("PoE");
  if (/wi-?fi|wireless/.test(t)) out.push("Wi-Fi");
  if (/\b4g\b|\blte\b/.test(t)) out.push("4G");
  if (/solar/.test(t)) out.push("Solar");
  return out.length ? out.join(", ") : undefined;
}

/** HiWatch: HWI-B / HWT-D / E-HWIT — the letter after the series is the shape. */
function hiwatchShape(model: string): string | undefined {
  const m = model.toUpperCase().match(/^(?:E-)?HW[IT]-?([BDT])/);
  if (!m) return undefined;
  return { B: "Bullet", D: "Dome", T: "Turret" }[m[1] as "B" | "D" | "T"];
}

/**
 * Hikvision IP cameras: the digit after DS-2CD1 / DS-2CD2 is the shape.
 * Checked against every model whose sheet names its shape: 0 bullet (80 of
 * 80), 1 dome (62/62), 5 dome (30/30), 4 cube (9/9), 7 dome (59/63),
 * 3 turret (79/100). "T" means bullet in one series and turret in another,
 * so it is left alone. Used only when nothing else says.
 */
function hikvisionIpShape(model: string): string | undefined {
  // The 1-series "T" is a turret: the ColorVu 1 Series sheet heads them
  // "1T series Turrent".
  if (/^DS-2CD1T/i.test(model)) return "Turret";
  const m = model.toUpperCase().match(/^DS-2CD\d([013457])/);
  if (!m) return undefined;
  return { "0": "Bullet", "1": "Dome", "3": "Turret", "4": "Cube", "5": "Dome", "7": "Dome" }[m[1]];
}

/** Recorder channels from the model number (DS-7208…, HWN-2104…) or the description. */
export function channelsFrom(model: string, description: string, isRecorder: boolean): string | undefined {
  const m = model.toUpperCase();
  const hik = m.match(/^I?DS-(?:7[1-9]|9[0-9])(\d{2})[HN]/);
  if (hik) return `${Number(hik[1])}ch`;
  // HWN-2104MH, HWD-6108…: the last two of the four digits.
  const hw = m.match(/^HW[ND]-\d{2}(\d{2})/);
  if (hw) return `${Number(hw[1])}ch`;
  if (!isRecorder) return undefined;
  const d = description.match(/(\d+)\s*-?\s*(?:ch\b|channels?)/i);
  return d ? `${Number(d[1])}ch` : undefined;
}

export function extractSpecs(input: {
  model: string;
  category: string;
  description: string;
  fields?: Partial<Record<string, string>>;
  /** The group row above the model ("ColorVu Lite+MD2.0 10 series bullet"). */
  group?: string;
}): Specs {
  const group = input.group ?? "";
  const f = input.fields ?? {};
  const desc = input.description;
  const all = `${Object.values(f).join(" ")} ${desc}`;
  const cat = input.category.toLowerCase();
  const model = input.model.toUpperCase();
  const isRecorder = /\b[dn]vr\b/.test(cat) || /^I?DS-(?:7[1-9]|9[0-9])\d{2}[HN]|^HW[ND]-/.test(model);
  const isSwitch = /^DS-3[ET]\d/.test(model) || /switch/.test(cat);
  const isKit = /\bkit\b/.test(cat) || /\bkit\b/i.test(input.model);
  // A camera by its sheet, its model number or the start of its description
  // ("VIGI 4MP Turret Network Camera"). A mesh router whose description
  // mentions "4K-QAM" is not one.
  const head = `${cat} ${input.group ?? ""} ${desc.slice(0, 120)}`.toLowerCase();
  const isCamera =
    !isRecorder &&
    !isSwitch &&
    !isKit &&
    (/^DS-2C[DEV]|^(?:E-)?HW[IT]|^IPC-|^VIGI C|^INSIGHT|^TAPO C\d/.test(model) ||
      /camera|cctv|\bipc\b|colorvu|easyip|eco - value|two-way audio|hiwatch|turret|bullet|dome|fisheye|ptz/.test(head));

  const specs: Specs = {};
  // Kits carry it in the model: "TVI-4CH2D2B-2MP-Eco".
  if (isCamera || isRecorder || isKit) specs.mp = (f.mp && mpFrom(f.mp)) || mpFrom(desc) || mpFrom(input.model.replace(/[-_]/g, " "));
  if (isCamera) {
    specs.shape = (f.shape && shapeFrom(f.shape)) || shapeFrom(desc) || shapeFrom(group) || hiwatchShape(model) || hikvisionIpShape(model);
    specs.place =
      (f.place && placeFrom(f.place)) ||
      placeFrom(desc) ||
      placeFrom(group) ||
      // An IP65+ rating means it's built for outdoors.
      (/\bip6[5-8]\b/i.test(all) ? "Outdoor" : undefined) ||
      // Last resort, the way you'd read the picture: domes go indoors,
      // bullets outdoors.
      (specs.shape === "Dome" ? "Indoor" : specs.shape === "Bullet" ? "Outdoor" : undefined);
    specs.lens = (f.lens && lensFrom(f.lens)) || lensFrom(desc);
    specs.night = nightFrom(`${f.night ?? ""} ${desc}`);
  }
  specs.channels = channelsFrom(input.model, desc, isRecorder) ?? (/(\d+)\s*CH/i.test(input.model) ? `${Number(input.model.match(/(\d+)\s*CH/i)![1])}ch` : undefined);
  specs.extras = extrasFrom(all, isCamera);
  for (const k of Object.keys(specs) as SpecKey[]) if (!specs[k]) delete specs[k];
  return specs;
}

export const SPEC_LABELS: Record<SpecKey, string> = {
  mp: "MP",
  shape: "Shape",
  place: "Indoor/Outdoor",
  lens: "Lens",
  night: "Night vision",
  channels: "Channels",
  extras: "Extras",
};
