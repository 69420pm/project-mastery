/** The Course list. */
export const COURSE_LIST_PATH = "/courses";

/** Where opening a Course leads: a new Chat in it. */
export function coursePath(courseId: string): string {
  return `${COURSE_LIST_PATH}/${courseId}/chat`;
}

/** The Materials page of a Course. */
export function materialsPath(courseId: string): string {
  return `${COURSE_LIST_PATH}/${courseId}/materials`;
}
