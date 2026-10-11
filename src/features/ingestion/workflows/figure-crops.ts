import "server-only";
import sharp from "sharp";
import {
  cropRectangle,
  type NormalizedBox,
} from "@/features/ingestion/domain/figure-crop";

/**
 * Crops a figure out of its page image, as a PNG. Null when the box cannot
 * be used (missing, empty, inverted, outside the page), so the caller keeps
 * the whole page image as the figure's picture.
 */
export async function cropFigure(
  pageImage: Uint8Array,
  box: NormalizedBox | null,
): Promise<Uint8Array | null> {
  const { width, height } = await sharp(pageImage).metadata();
  if (!width || !height) return null;
  const rectangle = cropRectangle(box, { width, height });
  if (!rectangle) return null;
  const png = await sharp(pageImage).extract(rectangle).png().toBuffer();
  return new Uint8Array(png);
}
