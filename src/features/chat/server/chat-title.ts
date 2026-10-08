import "server-only";
import { generateText } from "ai";
import { chatTitleSettings } from "@/features/chat/ai/title";
import { generatedTitle } from "@/features/chat/domain/chat-label";
import {
  setGeneratedTitle,
  type Supabase,
} from "@/features/chat/server/chat-store";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * Names an untitled Chat from the Student's first message with the `title`
 * task. The call counts against the Daily limit like any AI call: at the
 * limit, the Chat stays untitled and the list shows its first message. A
 * failure is logged, never thrown, since the reply has already been given.
 */
export async function titleChat(
  supabase: Supabase,
  {
    chatId,
    userId,
    firstMessage,
  }: { chatId: string; userId: string; firstMessage: string },
): Promise<void> {
  try {
    const dailyLimit = await checkDailyLimit(supabase);
    if (dailyLimit.level === "reached") return;

    const settings = chatTitleSettings();
    const result = await withTraceAttributes(
      { userId, sessionId: chatId, traceName: "chat-title" },
      () => generateText({ ...settings, prompt: firstMessage }),
    );
    await recordAiUsage(supabase, {
      task: "title",
      modelId: settings.model,
      usage: tokenUsage(result.usage),
      chatId,
    });

    const title = generatedTitle(result.text);
    if (title) await setGeneratedTitle(supabase, chatId, title);
  } catch (error) {
    console.error("Naming the Chat failed:", error);
  }
}
