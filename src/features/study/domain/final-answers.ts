import { evaluate, isUnit, unit, type Unit } from "mathjs";
import type { FinalAnswer } from "@/features/knowledge-map";

/**
 * The numeric check of `grade` (#173): a Student's final value against an
 * Exercise's final answers, parsed with their units by mathjs and compared
 * at 1% relative tolerance.
 */

/** How far a value may be off its key, relative to the key. */
const TOLERANCE = 0.01;

/** The longest final value parsed. */
const MAX_LENGTH = 100;

/** A parsed quantity: a plain number, or a mathjs unit with its value. */
type Quantity = number | Unit;

/**
 * A final value such as "17.5 kN", "1.2e5 Pa", "9.81 m/s^2" or "0.508" as a
 * number or a unit with its value; null for anything else, such as a bare
 * unit, a matrix or text mathjs can't read.
 */
export function parseFinalValue(text: string): Quantity | null {
  const source = text.trim().replaceAll("·", " ").replaceAll("°C", "degC");
  if (source === "" || source.length > MAX_LENGTH) return null;
  let value: unknown;
  try {
    value = evaluate(source, {});
  } catch {
    return null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isUnit(value) && value.value !== null && Number.isFinite(value.value)) {
    return value;
  }
  return null;
}

/** A key's value with its unit; null when mathjs doesn't know the unit. */
function keyQuantity(key: FinalAnswer): Quantity | null {
  if (key.unit === null) return key.value;
  try {
    return unit(key.value, key.unit);
  } catch {
    return null;
  }
}

/** Whether `value` is within the tolerance of `key`, in the key's terms. */
function matches(value: Quantity, key: Quantity): boolean {
  const within = (given: number, expected: number) =>
    Math.abs(given - expected) <= TOLERANCE * Math.abs(expected);
  if (typeof key === "number") {
    return typeof value === "number" && within(value, key);
  }
  // A value without a unit is read in the key's unit.
  if (typeof value === "number") return within(value, key.toNumber());
  if (!value.equalBase(key)) return false;
  // In the key's unit, so "17500 N" meets "17.5 kN" and "573 K" "300 degC".
  try {
    return within(value.toNumber(key.formatUnits()), key.toNumber());
  } catch {
    return false;
  }
}

/**
 * `match` when the final value is within 1% of any of the keys in a
 * compatible unit, `mismatch` when it is of none, and null when no key can
 * be read, so nothing is checked.
 */
export function checkFinalValue(
  value: Quantity,
  keys: FinalAnswer[],
): "match" | "mismatch" | null {
  const readable = keys.flatMap((key) => {
    const quantity = keyQuantity(key);
    return quantity === null ? [] : [quantity];
  });
  if (readable.length === 0) return null;
  return readable.some((key) => matches(value, key)) ? "match" : "mismatch";
}
