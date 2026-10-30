// Public API of the priorities feature for server code only: the Priority of
// each KC of a Course for the Student's exam, computed when read from the map
// (through the knowledge-map feature), the Materials and the Brief. App
// pages show the Priorities, and the study feature ranks the AI's
// candidates by them.
import "server-only";

export { getPriorities, loadKcPriorities } from "./server/priorities";
