/**
 * A Question's answer in a Chat (#251): every Student message between its
 * `ask` and its grade, joined in order. Pure.
 */

/** The most characters `questions.answer_text` holds. */
export const MAX_ANSWER_TEXT = 20_000;

/**
 * The answer with the Student's next message `text` added after a blank
 * line, cut at `MAX_ANSWER_TEXT`; `previous` is null before the first.
 */
export function joinAnswer(previous: string | null, text: string): string {
  const joined = previous === null ? text : `${previous}\n\n${text}`;
  return joined.slice(0, MAX_ANSWER_TEXT);
}
