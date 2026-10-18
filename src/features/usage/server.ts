// Public API of the usage feature for server code only: recording AI calls
// and checking the Daily limit, for every feature that calls models.
import "server-only";

export {
  checkDailyLimit,
  dailyLimitReachedMessage,
  getDailyLimitStatus,
} from "./server/daily-limit";
export { meteredEmbed, meteredGenerate } from "./server/metered-call";
export {
  loadReplyUsage,
  recordReplyUsage,
  type StoredReplyUsage,
} from "./server/reply-usage";
export {
  recordAiUsage,
  type AdminStudentScope,
  type AiUsageRecord,
  type StudentScope,
} from "./server/usage-store";
