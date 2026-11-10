/**
 * Which notes `addNote` turns away: one the notes already hold, and one
 * that only restates the exam format, which `saveBrief`'s fields store.
 * Both compare content words, so a reworded note still counts.
 */

/** Short words that carry nothing a note is about, English and German. */
const FILLER = new Set(
  (
    "the and with are not for from that this there its was has have any all " +
    "also can will may should what which who but into than then they them " +
    "und ist ein eine einen der die das mit nicht kein keine keinen sind " +
    "wird darf dürfen auch auf für von bei oder aber nur"
  ).split(" "),
);

/** The words of a note's content: lower case, three letters or more. */
function contentWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => word.length >= 3 && !FILLER.has(word),
    ),
  );
}

/** The share of words two notes share, of all words either has. */
function overlap(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 1;
  return [...a].filter((word) => b.has(word)).length / union;
}

/** How much two notes may share before the second repeats the first. */
const REPEAT_OVERLAP = 0.6;

/**
 * Whether `text` says what one of `notes` already says, in the same or
 * other words.
 */
export function repeatsNote(text: string, notes: readonly string[]): boolean {
  const words = contentWords(text);
  return notes.some(
    (note) => overlap(words, contentWords(note)) >= REPEAT_OVERLAP,
  );
}

/** The words of the exam format that `saveBrief` stores. */
const FORMAT_WORDS = new Set(
  (
    "exam exams format closed open book books formula formulas sheet sheets " +
    "calculator calculators aids allowed permitted confirmed clarified " +
    "prüfung klausur format geschlossen offen buch formelsammlung " +
    "formelblatt formelzettel taschenrechner hilfsmittel erlaubt zugelassen"
  ).split(" "),
);

/** The share of a note's words that must be format words to restate it. */
const FORMAT_SHARE = 0.75;

/**
 * Whether `text` only restates the exam format (open book, formula sheet,
 * calculator), as "Closed book; no formula sheet, no calculator."
 */
export function restatesFormat(text: string): boolean {
  const words = [...contentWords(text)];
  if (words.length === 0) return false;
  const format = words.filter((word) => FORMAT_WORDS.has(word)).length;
  return format / words.length >= FORMAT_SHARE;
}

/** The single notes of a Brief's notes, which `addNote` separates by a blank line. */
export function splitNotes(notes: string | null): string[] {
  return (notes ?? "")
    .split(/\n\s*\n/)
    .map((note) => note.trim())
    .filter((note) => note !== "");
}
