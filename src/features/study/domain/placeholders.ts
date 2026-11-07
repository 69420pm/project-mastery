/**
 * The numbers of a generated Problem (#183): its statement and solution name
 * every number as a `{{variable}}` of its program, and code fills each in
 * from the program's values, so no number comes from the model's arithmetic.
 */
import { evaluate, format, isComplex, isMatrix } from "mathjs";

/**
 * A value a placeholder takes: a number with its unit, or, with `value`
 * null, the mathjs text of a vector, matrix or complex number.
 */
export type PlaceholderValue = {
  value: number | null;
  unit: string | null;
  text?: string;
};

/** The longest vector, matrix or complex text filled in. */
const MAX_TEXT = 2_000;

/**
 * A vector, matrix or complex number's text at 4 significant figures; null
 * for any other text.
 */
function formatText(text: string): string | null {
  if (text.length > MAX_TEXT) return null;
  let value: unknown;
  try {
    value = evaluate(text);
  } catch {
    return null;
  }
  if (!isMatrix(value) && !isComplex(value)) return null;
  return format(value, { precision: SIGNIFICANT_FIGURES });
}

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
    if (found !== undefined && found.value !== null) {
      return formatValue(found.value, found.unit);
    }
    const text = found?.text === undefined ? null : formatText(found.text);
    if (text === null) {
      unresolved.add(placeholder);
      return placeholder;
    }
    return text;
  });
  if (unresolved.size > 0) {
    return {
      ok: false,
      error: `Unresolved placeholders: ${[...unresolved].join(", ")}. Each must name a variable the program assigns a number, a quantity, a vector, a matrix or a complex number to.`,
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
