/**
 * An Exercise's label, built when read from its question chunk (#221):
 * "<number as printed> · <Material> p. N", or "<Material> p. N" without a
 * number.
 */
export function exerciseLabel(question: {
  exerciseNumber: string | null;
  materialName: string;
  pageFrom: number;
}): string {
  const place = `${question.materialName} p. ${question.pageFrom}`;
  const number = question.exerciseNumber?.trim();
  return number ? `${number} · ${place}` : place;
}
