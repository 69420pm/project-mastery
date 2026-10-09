// Public API of the courses feature for any code, client or server.
// Server-only exports live in `server.ts`. It never imports the chat feature.
export { CourseList } from "./components/course-list";
export type { CourseListItem } from "./types";
