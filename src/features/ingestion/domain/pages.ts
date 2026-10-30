/**
 * What code decides about a Material's pages: which it skips without a page
 * call (slide overlays from the PDF's text layer, blank renders from their
 * pixels) and the languages its page calls gave.
 */

/** A page's text without any whitespace, so line breaks never matter. */
function collapse(text: string): string {
  return text.replaceAll(/\s+/g, "");
}

/**
 * The 1-based numbers of the pages that are slide overlays: a page whose
 * collapsed text is non-empty and is the start of the next page's text, so
 * the next page shows everything it does and more.
 */
export function overlayPages(texts: readonly string[]): number[] {
  const collapsed = texts.map(collapse);
  return collapsed.flatMap((text, index) => {
    const next = collapsed[index + 1];
    return text !== "" && next !== undefined && next.startsWith(text)
      ? [index + 1]
      : [];
  });
}

/** A channel value below this is ink, not paper. */
const INK_BELOW = 200;

/**
 * The share of ink pixels under which a render counts as blank: 0.05% of a
 * 2,000 × 1,414 render is about 1,400 pixels, enough for a page number or a
 * scanner speck but not for a line of text.
 */
const BLANK_INK_SHARE = 0.0005;

/**
 * Whether a render is almost all white, from its RGBA pixels: a page call
 * would find nothing to transcribe on it.
 */
export function isBlankRender(rgba: Uint8ClampedArray): boolean {
  const pixels = rgba.length / 4;
  const limit = pixels * BLANK_INK_SHARE;
  let ink = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      Math.min(rgba[i] ?? 255, rgba[i + 1] ?? 255, rgba[i + 2] ?? 255) <
      INK_BELOW
    ) {
      ink += 1;
      if (ink > limit) return false;
    }
  }
  return true;
}

/** A primary language subtag, then optional subtags: de, en-GB, zh-Hant. */
const BCP_47 = /^[a-z]{2,3}(-[a-z\d]{2,8})*$/i;

/**
 * A page call's language as a BCP 47 tag, or null when it gave something
 * else, such as a language's name.
 */
export function languageTag(language: string): string | null {
  const tag = language.trim();
  return BCP_47.test(tag) && tag.length <= 35 ? tag : null;
}

/**
 * A Material's language: the most common language of its read pages, the
 * earliest on a tie; null when no page gave one.
 */
export function mostCommonLanguage(
  languages: ReadonlyArray<string | null>,
): string | null {
  const counts = new Map<string, number>();
  for (const language of languages) {
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [language, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = language;
  }
  return best;
}
