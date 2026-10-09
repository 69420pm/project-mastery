// Public API of the courses feature for any code, client or server.
// Server-only exports live in `server.ts`. It never imports the chat feature.
export { CourseList } from "./components/course-list";
export { CourseNav } from "./components/course-nav";
export { CourseSwitcher } from "./components/course-switcher";
export { Materials } from "./components/materials";
export { MaterialsLink } from "./components/materials-link";
export {
  COURSE_LIST_PATH,
  coursePath,
  materialsPath,
} from "./domain/course-paths";
export { courseNotFoundMessage } from "./schemas";
export type {
  CourseListItem,
  CourseWithCounts,
  MaterialListItem,
} from "./types";
