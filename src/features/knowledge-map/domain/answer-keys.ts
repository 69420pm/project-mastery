import { all, create, type MathNode } from "mathjs";
import { MAX_ANSWER_LENGTH } from "@/features/knowledge-map/schemas";

/**
 * Answer keys (#249): the final results of Exercises and generated Problems
 * as mathjs expressions, and the code check of a Student's final value
 * against one. The Chat's `grade` and Mock grading use the same check.
 */

/**
 * One final result: its label, such as "Thrust", and its value as a mathjs
 * expression, such as `12 kg*m/s^2`, `[[1,2],[0,1]]`, `n+1` or `3+4i`.
 * `anyOrder` marks a list whose order does not matter.
 */
export type AnswerKey = { label: string; value: string; anyOrder: boolean };

/** How a value compared with its key. */
export type AnswerCheck = "match" | "mismatch" | "unchecked";

/** A value given for a key; with one key, the label may be left out. */
export type GivenValue = { label?: string | null; value: string };

/** How far a value may be off its key: relative, plus absolute for zero. */
const RELATIVE = 0.01;
const ABSOLUTE = 1e-9;

/** The points an expression with free symbols is compared at. */
const POINTS = 5;
const MIN_EVALUATED = 3;

// An instance without the functions that would let a short value allocate
// or evaluate without bound, or change the instance itself.
const math = create(all!);
// Taken before `parse` is disabled; its nodes compile against `math`.
const parse = math.parse;
const disabled = (name: string) => () => {
  throw new Error(`${name} is not allowed in an answer`);
};
math.import(
  Object.fromEntries(
    [
      "import",
      "createUnit",
      "evaluate",
      "parse",
      "compile",
      "simplify",
      "derivative",
      "resolve",
      "range",
      "zeros",
      "ones",
      "identity",
      "matrixFromFunction",
      "resize",
      "kron",
      "random",
      "randomInt",
      "pickRandom",
    ].map((name) => [name, disabled(name)]),
  ),
  { override: true },
);

/** A value mathjs cannot parse: the caller reports it. */
export class UnreadableAnswerError extends Error {
  override name = "UnreadableAnswerError";
}

/** Text as mathjs reads it: typographic signs replaced. */
function normalize(text: string): string {
  return text
    .trim()
    .replaceAll("·", "*")
    .replaceAll("×", "*")
    .replaceAll("−", "-")
    .replaceAll("°C", "degC");
}

/** A parsed key or value: its node and the symbols that are not mathjs's. */
type Reading = { node: MathNode; symbols: string[] };

/** The text parsed, an assignment `x = 5` read as its value; null when unreadable. */
function read(text: string): Reading | null {
  const source = normalize(text);
  if (source === "" || source.length > MAX_ANSWER_LENGTH) return null;
  let node: MathNode;
  try {
    node = parse(source);
  } catch {
    return null;
  }
  if (node.type === "AssignmentNode")
    node = (node as unknown as { value: MathNode }).value;
  const symbols = new Set<string>();
  node.traverse((child, path, parent) => {
    if (child.type !== "SymbolNode") return;
    if (parent?.type === "FunctionNode" && path === "fn") return;
    const name = (child as unknown as { name: string }).name;
    if (!(name in math)) symbols.add(name);
  });
  return { node, symbols: [...symbols].sort() };
}

/** Whether mathjs can read a key's or a value's text. */
export function isReadableAnswer(text: string): boolean {
  return read(text) !== null;
}

/** Whether a value holds no infinite or NaN number. */
function finite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (math.isComplex(value)) {
    return Number.isFinite(value.re) && Number.isFinite(value.im);
  }
  if (math.isUnit(value)) return value.value === null || finite(value.value);
  if (math.isMatrix(value)) return finite(value.valueOf());
  if (Array.isArray(value)) return value.every(finite);
  return true;
}

/**
 * The node's value in the scope; undefined when it does not evaluate to a
 * finite value.
 */
function evaluate(node: MathNode, scope: Map<string, number>): unknown {
  try {
    const value: unknown = node.compile().evaluate(scope);
    return finite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const close = (given: number, key: number) =>
  Math.abs(given - key) <= RELATIVE * Math.abs(key) + ABSOLUTE;

/** Whether two scalars agree; null when they are no kind compared. */
function sameScalar(given: unknown, key: unknown): boolean | null {
  const scalar =
    typeof given === "number" ||
    math.isComplex(given) ||
    (math.isUnit(given) && given.value !== null);
  if (!scalar) return null;
  if (math.isUnit(key)) {
    if (key.value === null) return null;
    // A number without a unit is in no unit with the key's base.
    if (!math.isUnit(given) || !given.equalBase(key)) return false;
    // In the key's unit, so "17500 N" meets "17.5 kN".
    try {
      return close(given.toNumber(key.formatUnits()), key.toNumber());
    } catch {
      return false;
    }
  }
  if (typeof key === "number" || math.isComplex(key)) {
    if (typeof given !== "number" && !math.isComplex(given)) return false;
    const distance = Number(math.abs(math.subtract(given, key) as number));
    return distance <= RELATIVE * Number(math.abs(key)) + ABSOLUTE;
  }
  return null;
}

/** A matrix or array as a plain array without singleton dimensions. */
function squeezed(value: unknown): unknown[] | null {
  if (!math.isMatrix(value) && !Array.isArray(value)) return null;
  const plain = math.squeeze(value as number[]);
  const array = math.isMatrix(plain) ? (plain.valueOf() as unknown[]) : plain;
  return Array.isArray(array) ? array : [array];
}

/** Elements of `given` matched one to one with those of `key`, in any order. */
function sameMultiset(given: unknown[], key: unknown[]): boolean | null {
  const left = [...given];
  for (const expected of key) {
    let found = -1;
    for (const [index, element] of left.entries()) {
      const same = sameScalar(element, expected);
      if (same === null) return null;
      if (same) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    left.splice(found, 1);
  }
  return true;
}

/** Whether two values agree; null when they are no kind compared. */
function sameValue(
  given: unknown,
  key: unknown,
  anyOrder: boolean,
): boolean | null {
  const keyArray = squeezed(key);
  if (keyArray === null) {
    return squeezed(given) === null ? sameScalar(given, key) : false;
  }
  const givenArray = squeezed(given);
  if (givenArray === null) return false;
  const size = (array: unknown[]) =>
    JSON.stringify(math.size(array as number[]));
  if (size(givenArray) !== size(keyArray)) return false;
  const flat = (array: unknown[]) =>
    math.flatten(array as number[]) as unknown[];
  if (anyOrder && keyArray.every((element) => !Array.isArray(element))) {
    return sameMultiset(givenArray, keyArray);
  }
  const keys = flat(keyArray);
  const givens = flat(givenArray);
  let all = true;
  for (const [index, element] of keys.entries()) {
    const same = sameScalar(givens[index], element);
    if (same === null) return null;
    all &&= same;
  }
  return all;
}

/** The value of the symbol at the point: fixed, pseudo-random, in [0.5, 2.5). */
function pointValue(point: number, symbol: number): number {
  const fraction = ((point * 7 + symbol * 13 + 3) * 0.6180339887) % 1;
  return 0.5 + 2 * fraction;
}

/** Whether a reading evaluates without a scope to a value of its own. */
function constant(reading: Reading): unknown {
  const value = evaluate(reading.node, new Map());
  if (value === undefined) return undefined;
  if (math.isUnit(value) && value.value === null) return undefined;
  return value;
}

/**
 * A Student's value against a key: `match` within 1% (plus 1e-9 for zero)
 * in the key's unit, element by element for vectors and matrices, as
 * multisets for `anyOrder` lists, and at 5 fixed points for expressions
 * with free symbols, of which at least 3 must evaluate. `unchecked` for any
 * other kind of value. Throws UnreadableAnswerError for a value mathjs
 * cannot parse.
 */
export function checkAnswer(key: AnswerKey, value: string): AnswerCheck {
  const given = read(value);
  if (given === null) {
    throw new UnreadableAnswerError(`"${value}" is no value mathjs can read.`);
  }
  const expected = read(key.value);
  if (expected === null) return "unchecked";
  const keyValue = constant(expected);
  const givenValue = constant(given);
  if (keyValue !== undefined && givenValue !== undefined) {
    const same = sameValue(givenValue, keyValue, key.anyOrder);
    return same === null ? "unchecked" : same ? "match" : "mismatch";
  }
  const symbols = [...new Set([...expected.symbols, ...given.symbols])];
  if (symbols.length === 0) return "unchecked";
  let evaluated = 0;
  let all = true;
  for (let point = 0; point < POINTS; point++) {
    const scope = new Map(
      symbols.map((symbol, index) => [symbol, pointValue(point, index)]),
    );
    const at = evaluate(expected.node, scope);
    const givenAt = evaluate(given.node, scope);
    if (at === undefined || givenAt === undefined) continue;
    const same = sameValue(givenAt, at, key.anyOrder);
    if (same === null) continue;
    evaluated++;
    all &&= same;
  }
  if (evaluated < MIN_EVALUATED) return "unchecked";
  return all ? "match" : "mismatch";
}

const labelKey = (label: string) => label.trim().toLowerCase();

/**
 * Each key's check against the values given for it, by label; with one key
 * and one value, the label may be left out. Null for a key without a
 * value. Without keys, the values check nothing. The error names what to
 * fix: a label no key has, a value given twice or a value mathjs cannot
 * read.
 */
export function checkAnswers(
  keys: readonly AnswerKey[],
  given: readonly GivenValue[],
):
  | { ok: true; checks: Array<AnswerCheck | null> }
  | { ok: false; error: string } {
  if (keys.length === 0) return { ok: true, checks: [] };
  const labels = keys.map((key) => key.label).join(", ");
  const valueOf = new Map<number, string>();
  for (const [at, { label, index }] of keyIndexes(keys, given).entries()) {
    if (index < 0) {
      return {
        ok: false,
        error: `${label ? `"${label}" is no` : "Give each value the"} label of a final result: ${labels}.`,
      };
    }
    if (valueOf.has(index)) {
      return {
        ok: false,
        error: `Give one value for "${keys[index]!.label}".`,
      };
    }
    valueOf.set(index, given[at]!.value);
  }
  const checks: Array<AnswerCheck | null> = [];
  for (const [index, key] of keys.entries()) {
    const value = valueOf.get(index);
    try {
      checks.push(value === undefined ? null : checkAnswer(key, value));
    } catch (error) {
      if (!(error instanceof UnreadableAnswerError)) throw error;
      return {
        ok: false,
        error: `${error.message} Write it as mathjs, such as "17.5 kN", "[[1, 2], [0, 1]]", "n + 1" or "3 + 4i".`,
      };
    }
  }
  return { ok: true, checks };
}

/**
 * Each key's own check, for a grading that cannot ask again: a value whose
 * label no key has, or a key's second value, is left out, and a value
 * mathjs cannot read is `unchecked`, so no value hides another key's check.
 * Null for a key without a value.
 */
export function checkEachAnswer(
  keys: readonly AnswerKey[],
  given: readonly GivenValue[],
): Array<AnswerCheck | null> {
  const valueOf = new Map<number, string>();
  for (const [at, { index }] of keyIndexes(keys, given).entries()) {
    if (index >= 0 && !valueOf.has(index)) {
      valueOf.set(index, given[at]!.value);
    }
  }
  return keys.map((key, index) => {
    const value = valueOf.get(index);
    if (value === undefined) return null;
    try {
      return checkAnswer(key, value);
    } catch (error) {
      if (error instanceof UnreadableAnswerError) return "unchecked";
      throw error;
    }
  });
}

/**
 * The key each given value is for, by label, -1 for none; with one key and
 * one value, the label may be left out.
 */
function keyIndexes(
  keys: readonly AnswerKey[],
  given: readonly GivenValue[],
): Array<{ label: string | null | undefined; index: number }> {
  return given.map(({ label }) => ({
    label,
    index:
      keys.length === 1 && given.length === 1
        ? 0
        : keys.findIndex(
            (key) => label && labelKey(key.label) === labelKey(label),
          ),
  }));
}

/**
 * The worst of the checks, as an Attempt stores it: `mismatch`, then
 * `unchecked` (a key without a value counts as one), then `match`; null
 * without keys.
 */
export function worstCheck(
  checks: ReadonlyArray<AnswerCheck | null>,
): AnswerCheck | null {
  if (checks.length === 0) return null;
  if (checks.includes("mismatch")) return "mismatch";
  if (checks.some((check) => check !== "match")) return "unchecked";
  return "match";
}
