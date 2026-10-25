/**
 * The numbers of a generated Problem (#183): its statement and solution name
 * every number as a `{{variable}}` of its program, and code fills each in
 * from the program's values, so no number comes from the model's arithmetic.
 */

/** A value a placeholder takes: a number with its unit, or none. */
export type PlaceholderValue = { value: number | null; unit: string | null };

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Significant figures of a filled-in number. */
const SIGNIFICANT_FIGURES = 4;

/** A number at 4 significant figures, trailing zeros dropped, with its unit. */
export function formatValue(value: number, unit: string | null): string {
  const number = String(Number(value.toPrecision(SIGNIFICANT_FIGURES)));
  return unit ? `${number} ${unit}` : number;
}

/**
 * The text with every `{{variable}}` replaced by its value, or the error
 * naming the placeholders without a numeric value. A `{{` left over, as of
 * a malformed placeholder, is an error too; a `}}` is not, since LaTeX
 * writes one in `\frac{1}{\sqrt{2}}`.
 */
export function fillPlaceholders(
  text: string,
  values: Record<string, PlaceholderValue>,
): { ok: true; text: string } | { ok: false; error: string } {
  const unresolved = new Set<string>();
  const filled = text.replace(PLACEHOLDER, (placeholder, name: string) => {
    const found = Object.hasOwn(values, name) ? values[name] : undefined;
    if (found?.value === null || found === undefined) {
      unresolved.add(placeholder);
      return placeholder;
    }
    return formatValue(found.value, found.unit);
  });
  if (unresolved.size > 0) {
    return {
      ok: false,
      error: `Unresolved placeholders: ${[...unresolved].join(", ")}. Each must name a variable the program assigns a number or quantity to.`,
    };
  }
  if (filled.includes("{{")) {
    return {
      ok: false,
      error:
        "A malformed placeholder is left: write each number as {{variable}}.",
    };
  }
  return { ok: true, text: filled };
}
