// Public API of the courses feature for server code only.
import "server-only";

export {
  getCourse,
  getCourseWith,
  getCourseList,
  getMaterialList,
  getMaterials,
  readMaterialFile,
} from "./server/queries";
export type { StoredMaterial } from "./types";
// Also in `index.ts`. Server code that smoke checks load imports them from
// here, because `index.ts` loads React components, which fail outside Next.js.
export { materialChunksPath } from "./domain/course-paths";
export { courseNotFoundMessage, materialReferenceSchema } from "./schemas";
