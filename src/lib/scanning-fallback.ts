import {
  BinaryBitmap,
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  RGBLuminanceSource,
} from "@zxing/library";
import type { BarcodeDetectorLike } from "@/lib/scanning";

/**
 * A barcode reader for browsers that have none of their own.
 *
 * Every browser on iOS is Safari underneath, and Safari has no BarcodeDetector,
 * so an iPhone could not scan at all. This reads the same formats in plain
 * JavaScript instead.
 *
 * In its own module and imported only when needed, so the phones that already
 * have a reader never download it.
 */

/**
 * Frames are downscaled to this width before decoding.
 *
 * Not lower: a Code 39 label carrying a dozen characters has very narrow bars,
 * and at 720px they blur into each other and nothing decodes at all. This is a
 * trade against speed, and legibility has to win.
 */
const MAX_WIDTH = 1280;

export function createFallbackDetector(): BarcodeDetectorLike {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.DATA_MATRIX,
  ]);
  // Without this the 1D readers sample only a handful of rows across the image
  // and a barcode has to be almost perfectly placed to be found. It costs time
  // per frame and buys a scanner that actually reads.
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);

  const canvas = document.createElement("canvas");
  // Read back every frame, so tell the browser not to keep the surface on the
  // GPU — without this getImageData is far slower.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return {
    async detect(source: CanvasImageSource) {
      const video = source as HTMLVideoElement;
      const sw = video.videoWidth || 0;
      const sh = video.videoHeight || 0;
      if (!ctx || !sw || !sh) return [];

      const scale = Math.min(1, MAX_WIDTH / sw);
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      const { data } = ctx.getImageData(0, 0, w, h);
      // Green-favouring average, the same cheap luminance zxing uses itself.
      const luminance = new Uint8ClampedArray(w * h);
      for (let i = 0, p = 0; p < luminance.length; i += 4, p++) {
        luminance[p] = (data[i] + 2 * data[i + 1] + data[i + 2]) / 4;
      }

      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, w, h)));
      try {
        // decodeWithState, not decode: decode() compares the hints passed in
        // against the ones held, and calling it without any threw away the
        // formats set above and rebuilt every reader, on every single frame.
        return [{ rawValue: reader.decodeWithState(bitmap).getText() }];
      } catch (e) {
        // "Nothing readable in this frame" is the usual answer and means
        // nothing. Anything else — a blocked canvas, say — is a real fault and
        // is left to surface rather than being swallowed frame after frame.
        if (
          e instanceof NotFoundException ||
          e instanceof ChecksumException ||
          e instanceof FormatException
        ) {
          return [];
        }
        throw e;
      }
    },
  };
}
