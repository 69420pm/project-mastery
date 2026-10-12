import { z } from "zod";

/**
 * A box on a page, normalized to the page's size: 0 to 1, from the top left.
 * Not range-checked here: an invalid box falls back to the whole page
 * (`usableBox`) instead of failing the page.
 */
export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type NormalizedBox = z.infer<typeof boxSchema>;

/**
 * The narrowest a shown box gets, as a share of the page's width: a narrower
 * figure is shown with its surroundings, so the page is not magnified too far
 * to render.
 */
const MIN_WIDTH = 0.25;

/** Padding around a figure, as a share of the page's width and height. */
const PADDING = 0.02;

/** Rounding slack for boxes that end exactly at the page's edge. */
const EPSILON = 1e-6;

/**
 * The box to show for a figure, padded and clamped to the page, and not too narrow. Null when the
 * box is missing, empty, inverted or not inside the page, so the caller shows
 * the whole page.
 */
export function usableBox(box: NormalizedBox | null): NormalizedBox | null {
  if (!box) return null;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
    return null;
  }

  const left = Math.max(0, x - PADDING);
  const top = Math.max(0, y - PADDING);
  const right = Math.min(1, x + width + PADDING);
  const bottom = Math.min(1, y + height + PADDING);
  if (right - left >= MIN_WIDTH) {
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  const center = (left + right) / 2;
  return {
    x: Math.min(Math.max(0, center - MIN_WIDTH / 2), 1 - MIN_WIDTH),
    y: top,
    width: MIN_WIDTH,
    height: bottom - top,
  };
}
