import "server-only";
import type { LanguageModelUsage } from "ai";
import { estimatedUsage, tokenUsage, type SentFile } from "@/lib/ai/cost";
import type { AiTask } from "@/lib/ai/models";
import type { SessionSupabase } from "@/lib/supabase/types";
import { recordAiUsage } from "./usage-store";

/**
 * Records the usage of one streamed reply for the signed-in Student, and
 * never throws: a failed record is logged. A stopped or failed call reports
 * no usage, so its cost is then estimated from the text and files sent and
 * the text received. Otherwise stopping or closing the tab would dodge the
 * Daily limit.
 *
 * With a `chatId` whose Chat, or Course, was deleted during the reply, the
 * spend is recorded without the Chat, so it still counts towards the limit.
 */
export async function recordReplyUsage(
  supabase: SessionSupabase,
  {
    task,
    modelId,
    reported,
    input,
    output,
    files,
    chatId,
    replyId,
  }: {
    task: AiTask;
    modelId: string;
    /** What the provider reported, undefined for a stopped or failed call. */
    reported: LanguageModelUsage | undefined;
    /** The text sent: the instructions and the history. */
    input: string;
    /** The reply's text. */
    output: string;
    /** The files sent with the history. */
    files?: SentFile[];
    chatId?: string;
    replyId?: string;
  },
): Promise<void> {
  const usage = reported
    ? { usage: tokenUsage(reported) }
    : {
        usage: estimatedUsage({ input, output, files }),
        estimated: true,
      };
  const record = { task, modelId, ...usage, replyId };
  try {
    await recordAiUsage(supabase, { ...record, chatId });
    return;
  } catch (error) {
    if (chatId === undefined) {
      console.error(`Recording the ${task} reply's usage failed:`, error);
      return;
    }
  }
  try {
    await recordAiUsage(supabase, record);
  } catch (error) {
    console.error(`Recording the ${task} reply's usage failed:`, error);
  }
}
