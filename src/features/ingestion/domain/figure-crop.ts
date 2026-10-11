/** A box on a page, normalized to the page's size: 0 to 1, from the top left. */
export type NormalizedBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A rectangle in the page image's pixels. */
export type PixelRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Padding around a figure, as a share of the page's longer side. */
const PADDING = 0.02;

/** Rounding slack for boxes that end exactly at the page's edge. */
const EPSILON = 1e-6;

/**
 * The pixel rectangle to crop for a figure's box, padded and clamped to the
 * page. Null when the box is missing, empty, inverted or not inside the page,
 * so the caller falls back to the whole page image.
 */
export function cropRectangle(
  box: NormalizedBox | null,
  page: { width: number; height: number },
): PixelRectangle | null {
  if (!box) return null;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
    return null;
  }

  const padding = Math.round(Math.max(page.width, page.height) * PADDING);
  const left = Math.max(0, Math.round(x * page.width) - padding);
  const top = Math.max(0, Math.round(y * page.height) - padding);
  const right = Math.min(
    page.width,
    Math.round((x + width) * page.width) + padding,
  );
  const bottom = Math.min(
    page.height,
    Math.round((y + height) * page.height) + padding,
  );
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
