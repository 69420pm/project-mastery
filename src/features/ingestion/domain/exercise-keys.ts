import type { ChunkLabel } from "@/features/ingestion/types";

/**
 * An exercise number as a comparable key: what comes before its first digit
 * ("Aufgabe", "Lösung zu") is dropped, and the rest is read as its numbers
 * and letters, so "7.2b" and "Aufgabe 7.2 b)" are both "7.2.b". Null
 * without a number.
 */
export function normalizeExerciseNumber(number: string | null): string | null {
  if (number === null) return null;
  const text = number.normalize("NFKC").toLowerCase();
  const firstDigit = text.search(/\d/);
  if (firstDigit === -1) return null;
  const parts = text.slice(firstDigit).match(/\d+|\p{L}+/gu) ?? [];
  return parts
    .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part))
    .join(".");
}

/** A chunk of one Material, in reading order, as keying sees it. */
export type KeyedChunk = { label: ChunkLabel; exerciseNumber: string | null };

/** Segments of a key that are numbers, such as 7 and 2 of 7.2.b. */
const NUMBER_SEGMENT = /^\d+$/;

/**
 * The root of a key: its leading numbers, so 7.2.b and 7.2 both have the
 * root 7.2. Null for a null key.
 */
export function rootKey(key: string | null): string | null {
  if (key === null) return null;
  const segments = key.split(".");
  const end = segments.findIndex((segment) => !NUMBER_SEGMENT.test(segment));
  return segments.slice(0, end === -1 ? segments.length : end).join(".");
}

/**
 * The key of each of a Material's chunks, in order. A number with a digit
 * is normalized ("Aufgabe 7.2 b)" is 7.2.b). A number without one, such as
 * `b)`, is keyed under the root of the nearest preceding chunk with the
 * same label whose number has a digit, so `b)` after `Aufgabe 7.2` or after
 * `7.2a` is 7.2.b; without such a chunk its key is null, as is the key of a
 * chunk without a number.
 */
export function exerciseKeys(chunks: KeyedChunk[]): (string | null)[] {
  const lastRoot = new Map<ChunkLabel, string>();
  return chunks.map(({ label, exerciseNumber }) => {
    const key = normalizeExerciseNumber(exerciseNumber);
    if (key !== null) {
      const root = rootKey(key);
      if (root) lastRoot.set(label, root);
      return key;
    }
    const letters = exerciseNumber
      ?.normalize("NFKC")
      .toLowerCase()
      .match(/\p{L}+/gu)
      ?.at(-1);
    const root = lastRoot.get(label);
    return letters && root ? `${root}.${letters}` : null;
  });
}
