/** The Course list. */
export const COURSE_LIST_PATH = "/courses";

/**
 * Where opening a Course leads: its home, the Course map. The knowledge-map
 * feature, which this one may not import, owns the same path.
 */
export function coursePath(courseId: string): string {
  return `${COURSE_LIST_PATH}/${courseId}/map`;
}

/** The Materials page of a Course. */
export function materialsPath(courseId: string): string {
  return `${COURSE_LIST_PATH}/${courseId}/materials`;
}

/** The chunk view of a parsed Material. */
export function materialChunksPath(
  courseId: string,
  materialId: string,
): string {
  return `${materialsPath(courseId)}/${materialId}`;
}
