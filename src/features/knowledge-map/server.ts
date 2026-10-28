// Public API of the knowledge-map feature for server code only: reading a
// Course's map, its build workflow, and the review queue of open Findings
// that the Brief asks about.
import "server-only";

// Also in `index.ts`: `index.ts` loads React components, which fail outside
// Next.js, so server code that smoke checks load imports it from here.
export { courseMapPath, topicPath } from "./domain/map-paths";
export { checkAnnotations, checkStudyText } from "./domain/reading-checks";
export { restrictMapToTopic } from "./domain/topic-map";
export { topicAnchors } from "./domain/topic-reading";
export { finalAnswerSchema } from "./schemas";
export { getChunkFindings } from "./server/chunk-findings";
export { loadCourseTopics, type CourseTopic } from "./server/course-topics";
export { getFindings } from "./server/findings";
export { getKnowledgeMap } from "./server/queries";
export { getTopicNames } from "./server/topic-names";
export {
  answerFinding,
  getOpenFindings,
  markFindingAsked,
} from "./server/review";
export { loadStoredMap } from "./server/stored-map";
export {
  findReadingSection,
  loadStoredReadingSections,
} from "./server/stored-reading-sections";
export { loadStoredTopics } from "./server/stored-topics";
export { buildKnowledgeMap } from "./workflows/build-knowledge-map";
