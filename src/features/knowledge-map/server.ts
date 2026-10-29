// Public API of the knowledge-map feature for server code only: reading a
// Course's map and its build workflow.
import "server-only";

// Also in `index.ts`: `index.ts` loads React components, which fail outside
// Next.js, so server code that smoke checks load imports it from here.
export { courseMapPath, topicPath } from "./domain/map-paths";
export { restrictMapToTopic } from "./domain/topic-map";
export { topicAnchors } from "./domain/topic-reading";
export { finalAnswerSchema } from "./schemas";
export { loadCourseTopics, type CourseTopic } from "./server/course-topics";
export { getKnowledgeMap } from "./server/queries";
export { getTopicNames } from "./server/topic-names";
export { loadStoredMap } from "./server/stored-map";
export {
  findReadingSection,
  loadStoredReadingSections,
} from "./server/stored-reading-sections";
export { loadStoredTopics } from "./server/stored-topics";
export { buildKnowledgeMap } from "./workflows/build-knowledge-map";
