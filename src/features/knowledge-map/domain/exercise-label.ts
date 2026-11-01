/**
 * An Exercise's label, built when read from its question chunk (#228):
 * "<Chapter title> · <Material> p. N", or "<Material> p. N" when the chunk
 * is in no Chapter below its Material's root.
 */
export function exerciseLabel(question: {
  chapterTitle: string | null;
  materialName: string;
  pageFrom: number;
}): string {
  const place = `${question.materialName} p. ${question.pageFrom}`;
  const chapter = question.chapterTitle?.trim();
  return chapter ? `${chapter} · ${place}` : place;
}
