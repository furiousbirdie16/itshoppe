import { supabase } from "@/integrations/supabase/client";

/** The logo printed on invoices, quotations and purchase orders. */
export interface DocumentLogo {
  dataUrl: string;
  /** Pixel size of the stored image, for keeping its shape on the page. */
  width: number;
  height: number;
  format: "PNG" | "JPEG";
}

const KEY = "document_logo";
/** Long side of the stored image. Plenty for a 30mm logo at print quality. */
const MAX_SIDE = 600;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settings = () => (supabase as any).from("app_settings");

/**
 * The uploaded logo, or null for the built-in one.
 *
 * Also null when the settings table is not there yet, so documents keep
 * printing with the built-in logo until the migration has been run.
 */
export async function getDocumentLogo(): Promise<DocumentLogo | null> {
  const { data, error } = await settings().select("value").eq("key", KEY).maybeSingle();
  if (error || !data?.value?.dataUrl) return null;
  return data.value as DocumentLogo;
}

export async function saveDocumentLogo(file: File): Promise<DocumentLogo> {
  const logo = await shrinkImage(file);
  const { error } = await settings().upsert({ key: KEY, value: logo, updated_at: new Date().toISOString() });
  if (error) throw error;
  return logo;
}

export async function clearDocumentLogo(): Promise<void> {
  const { error } = await settings().delete().eq("key", KEY);
  if (error) throw error;
}

/**
 * Scale a logo of `width` × `height` pixels to fit a box, keeping its shape.
 * Never enlarges past the box; a wide logo is limited by the width, a tall
 * one by the height.
 */
export function fitLogo(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { w: maxH, h: maxH };
  const scale = Math.min(maxW / width, maxH / height);
  return { w: width * scale, h: height * scale };
}

/**
 * Downscale in the browser and re-encode, so a 5 MB photo of a logo is stored
 * as a few tens of KB. PNG keeps a transparent background; anything without
 * one (a JPEG) stays JPEG, which is far smaller for photographic logos.
 */
async function shrinkImage(file: File): Promise<DocumentLogo> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPG, SVG or WebP).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image could not be read."));
      el.src = url;
    });
    const naturalW = img.naturalWidth || 300;
    const naturalH = img.naturalHeight || 300;
    const scale = Math.min(1, MAX_SIDE / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot process images.");
    const format: DocumentLogo["format"] = file.type === "image/jpeg" ? "JPEG" : "PNG";
    if (format === "JPEG") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(format === "JPEG" ? "image/jpeg" : "image/png", 0.92);
    return { dataUrl, width, height, format };
  } finally {
    URL.revokeObjectURL(url);
  }
}
