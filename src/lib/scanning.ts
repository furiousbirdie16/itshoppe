/**
 * The browser's own barcode reader.
 *
 * Chrome on Android — what the shop runs — ships BarcodeDetector, so scanning
 * costs no dependency there. Everywhere else typed entry stays the way in, and
 * the scan button simply does not appear rather than opening a camera that
 * cannot read anything.
 */
interface DetectedBarcode {
  rawValue: string;
  /** Where it sits in the frame. The loaded reader crops first, so omits it. */
  boundingBox?: { x: number; y: number; width: number; height: number };
}
export interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
export type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export const barcodeDetectorCtor = (): BarcodeDetectorCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector || null;
};

/** Whether this device has a camera the page may ask for at all. */
const hasCamera = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * Whether a scan button is worth showing at all on this device.
 *
 * A camera is now the only requirement: browsers without a reader of their own
 * get one loaded for them (see scanning-fallback), which is what iPhones need —
 * every browser there is Safari underneath and none has BarcodeDetector.
 */
export const canScan = () => hasCamera();

/**
 * The reader to use, preferring the browser's own.
 *
 * The fallback is imported only when it is actually needed, so devices with a
 * built-in reader never download it.
 */
export interface LoadedDetector {
  detector: BarcodeDetectorLike;
  /** Which reader answered, so the scanner can say so when something is wrong. */
  kind: "built-in" | "loaded";
}

export async function loadDetector(formats: string[]): Promise<LoadedDetector | null> {
  const Ctor = barcodeDetectorCtor();
  if (Ctor) {
    try {
      return { detector: new Ctor({ formats }), kind: "built-in" };
    } catch {
      // A browser that has the class but not these formats: fall through.
    }
  }
  if (!hasCamera()) return null;
  const { createFallbackDetector } = await import("@/lib/scanning-fallback");
  return { detector: createFallbackDetector(), kind: "loaded" };
}

/**
 * The part of the frame that counts, as a fraction of it from each edge.
 *
 * The scanner draws this box and only codes inside it are read. A box holds
 * several codes (MAC, serial, model), and with the wider view the rest of the
 * label, and whatever is on the desk, is in shot too.
 */
export const AIM_MARGIN = 0.12;

/** The code to read this frame: the one nearest the middle of the aiming box. */
export function pickAimed(found: DetectedBarcode[], frameW: number, frameH: number): DetectedBarcode | null {
  let best: DetectedBarcode | null = null;
  let bestDistance = Infinity;
  for (const code of found) {
    const box = code.boundingBox;
    if (!box) {
      if (!best) best = code;
      continue;
    }
    const x = (box.x + box.width / 2) / frameW;
    const y = (box.y + box.height / 2) / frameH;
    if (x < AIM_MARGIN || x > 1 - AIM_MARGIN || y < AIM_MARGIN || y > 1 - AIM_MARGIN) continue;
    const distance = Math.hypot(x - 0.5, y - 0.5);
    if (distance < bestDistance) {
      best = code;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Decides when a camera reading is real enough to act on.
 *
 * Two things go wrong with a naive "fire on first decode". A code only half
 * inside the frame still decodes, to a shorter and wrong value — so a reading
 * has to hold steady across several frames, and for long enough that it is not
 * one lucky frame, before the rest of the label has had a chance to arrive.
 * And a label sits in front of the lens for hundreds of frames, so once
 * accepted it must not fire again until it has left the view.
 *
 * Kept apart from the camera so the rules can be exercised without one.
 */
export interface ScanGateOptions {
  requiredReads?: number;
  requiredMs?: number;
  goneAfterMisses?: number;
  /** How long after the first frame nothing is read at all, to allow aiming. */
  armDelayMs?: number;
}

export function createScanGate(options: ScanGateOptions = {}) {
  const requiredReads = options.requiredReads ?? 4;
  const requiredMs = options.requiredMs ?? 250;
  const goneAfterMisses = options.goneAfterMisses ?? 5;
  const armDelayMs = options.armDelayMs ?? 0;

  let startedAt: number | null = null;
  let candidate = "";
  let reads = 0;
  let firstSeenAt = 0;
  let accepted = "";
  let misses = 0;

  /** One frame's reading. Returns the value to act on, or null. */
  return function feed(value: string | null | undefined, now: number): string | null {
    if (startedAt === null) startedAt = now;
    // Whatever the lens lands on while the scanner opens was not chosen, so it
    // does not even begin to count towards the hold below.
    if (now - startedAt < armDelayMs) return null;

    const seen = (value || "").trim();

    if (!seen) {
      misses += 1;
      if (misses >= goneAfterMisses) {
        // Out of view: start afresh, so the same unit can be scanned again on
        // purpose.
        candidate = "";
        reads = 0;
        accepted = "";
      }
      return null;
    }

    misses = 0;
    if (seen === candidate) {
      reads += 1;
    } else {
      candidate = seen;
      reads = 1;
      firstSeenAt = now;
    }

    const settled = reads >= requiredReads && now - firstSeenAt >= requiredMs;
    if (!settled || seen === accepted) return null;

    accepted = seen;
    reads = 0;
    return seen;
  };
}
