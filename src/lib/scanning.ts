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

/** Whether a scan button is worth showing at all on this device. */
export const canScan = () => !!barcodeDetectorCtor();

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
