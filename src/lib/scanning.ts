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
