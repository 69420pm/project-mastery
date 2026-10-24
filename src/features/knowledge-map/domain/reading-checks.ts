/**
 * The code checks of a Reading section's writing call (#178): what the model
 * wrote must point into the section's pages. A failed check throws, so the
 * step that made the call retries it.
 */

/** A section's pages, first to last. */
export type PageRange = { pageFrom: number; pageTo: number };

/** The reason of a section whose mode call failed for good. */
export const MODE_CALL_FAILED_REASON = "The mode call failed.";

/** The reason of a section whose writing call failed for good. */
export const WRITING_CALL_FAILED_REASON = "The writing call failed.";

/** The marker of a study text's one kind of paragraph without a citation. */
export const BEYOND_THE_COURSE = "> **Beyond the course:**";

const inRange = (page: number, { pageFrom, pageTo }: PageRange) =>
  page >= pageFrom && page <= pageTo;

const pagesOf = ({ pageFrom, pageTo }: PageRange) =>
  pageFrom === pageTo ? `p. ${pageFrom}` : `pp. ${pageFrom}–${pageTo}`;

/** Throws unless every note is on a page of the section. */
export function checkAnnotations(
  notes: ReadonlyArray<{ page: number; note: string }>,
  range: PageRange,
): void {
  if (notes.length === 0) throw new Error("The annotations have no note.");
  const outside = notes.filter((note) => !inRange(note.page, range));
  if (outside.length > 0) {
    throw new Error(
      `Notes on p. ${outside.map((note) => note.page).join(", ")} are outside ${pagesOf(range)}.`,
    );
  }
}

/** `[p. 3]`, `[pp. 3–4]` or `[pp. 3-4]`. */
const CITATION = /\[(?:p\. (\d+)|pp\. (\d+)\s*[–-]\s*(\d+))\]/g;

/** A citation at the end of a paragraph, before an optional full stop. */
const ENDS_WITH_CITATION = /\[(?:p\. \d+|pp\. \d+\s*[–-]\s*\d+)\]\.?$/;

/** Blocks that are no paragraph: headings, display math and rules. */
const isNoParagraph = (block: string) =>
  /^#{1,6} /.test(block) ||
  /^\$\$[\s\S]*\$\$$/.test(block) ||
  /^(?:-{3,}|\*{3,})$/.test(block);

/**
 * Throws unless every paragraph of the study text ends with a citation of
 * the section's pages, `[p. N]` or `[pp. N–M]`, and every citation in it is
 * in the section's range. A blockquote starting with "**Beyond the
 * course:**" needs none; headings, display math and rules are no paragraphs.
 */
export function checkStudyText(text: string, range: PageRange): void {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
  if (blocks.length === 0) throw new Error("The study text is empty.");
  const uncited = blocks.filter(
    (block) =>
      !isNoParagraph(block) &&
      !block.startsWith(BEYOND_THE_COURSE) &&
      !ENDS_WITH_CITATION.test(block),
  );
  if (uncited.length > 0) {
    throw new Error(
      `${uncited.length} paragraph(s) end without a citation, such as "${uncited[0]?.slice(-80)}".`,
    );
  }
  for (const [citation, page, from, to] of text.matchAll(CITATION)) {
    const first = Number(page ?? from);
    const last = Number(page ?? to);
    if (first > last || !inRange(first, range) || !inRange(last, range)) {
      throw new Error(`${citation} is outside ${pagesOf(range)}.`);
    }
  }
}
