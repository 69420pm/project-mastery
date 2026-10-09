// Public API of the courses feature for server code only.
import "server-only";

export {
  getCourse,
  getCourseList,
  getMaterialList,
  getMaterials,
  readMaterialFile,
} from "./server/queries";
export type { StoredMaterial } from "./types";
