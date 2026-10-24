/** The Course map page of a Course: the Course's home. */
export function courseMapPath(courseId: string): string {
  return `/courses/${courseId}/map`;
}

/** The page of a Topic on its Course's map. */
export function topicPath(courseId: string, topicId: string): string {
  return `${courseMapPath(courseId)}/${topicId}`;
}
