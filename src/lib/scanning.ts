/**
 * The browser's own barcode reader.
 *
 * Chrome on Android — what the shop runs — ships BarcodeDetector, so scanning
 * costs no dependency there. Everywhere else typed entry stays the way in, and
 * the scan button simply does not appear rather than opening a camera that
 * cannot read anything.
 */
interface DetectedBarcode { rawValue: string }
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
 * Decides when a camera reading is real enough to act on.
 *
 * Two things go wrong with a naive "fire on first decode". A code only half
 * inside the frame still decodes, to a shorter and wrong value — so a reading
 * has to hold steady across several frames, and for long enough that it is not
 * one lucky frame, before the rest of the label has had a chance to arrive.
 * And a label sits in front of the lens for hundreds of frames, so once
 * accepted it must not fire again until it has left the view or a cooldown has
 * passed.
 *
 * Kept apart from the camera so the rules can be exercised without one.
 */
export interface ScanGateOptions {
  requiredReads?: number;
  requiredMs?: number;
  repeatCooldownMs?: number;
  goneAfterMisses?: number;
}

export function createScanGate(options: ScanGateOptions = {}) {
  const requiredReads = options.requiredReads ?? 4;
  const requiredMs = options.requiredMs ?? 250;
  const repeatCooldownMs = options.repeatCooldownMs ?? 4000;
  const goneAfterMisses = options.goneAfterMisses ?? 5;

  let candidate = "";
  let reads = 0;
  let firstSeenAt = 0;
  let accepted = "";
  let acceptedAt = 0;
  let misses = 0;

  /** One frame's reading. Returns the value to act on, or null. */
  return function feed(value: string | null | undefined, now: number): string | null {
    const seen = (value || "").trim();

    if (!seen) {
      misses += 1;
      if (misses >= goneAfterMisses) {
        // Out of view: start afresh, so the same unit can be scanned again on
        // purpose without waiting out the cooldown.
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
    const repeat = seen === accepted && now - acceptedAt < repeatCooldownMs;
    if (!settled || repeat) return null;

    accepted = seen;
    acceptedAt = now;
    reads = 0;
    return seen;
  };
}
