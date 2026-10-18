import "server-only";
import { embedMany, generateText } from "ai";
import { checkDailyLimit } from "@/features/usage/server/daily-limit";
import { recordAiUsage } from "@/features/usage/server/usage-store";
import { estimatedUsage, tokenUsage } from "@/lib/ai/cost";
import { isDailyQuotaError } from "@/lib/ai/daily-quota";
import { aiTask, answeringModel, type AiTask } from "@/lib/ai/models";
import type { AdminSupabase } from "@/lib/supabase/types";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * One model call a workflow makes for a Student: checks their Daily limit,
 * runs the traced call and records its usage. Null when the Daily limit is
 * reached or the provider's daily quota is used up, so each step maps that
 * to its own outcome.
 */

type MeteredScope = {
  studentId: string;
  traceName: string;
  /**
   * Turns any other error of the model call itself into the step's own, for
   * a step that reports a failed call differently. Without it, the error is
   * thrown as it is.
   */
  callFailed?: (error: unknown) => never;
};

/** A `generateText` call, with the settings `aiTask` gives. */
type GenerateCall = Parameters<typeof generateText>[0] & {
  model: string;
  providerOptions?: { gateway?: { models?: readonly string[] } };
};

/**
 * A metered `generateText` call. The result's `output` is read lazily, as
 * the AI SDK's is, so a step can handle a call that gave none.
 */
export async function meteredGenerate(
  admin: AdminSupabase,
  { studentId, task, traceName, callFailed }: MeteredScope & { task: AiTask },
  call: GenerateCall,
): Promise<{ readonly output: unknown } | null> {
  const dailyLimit = await checkDailyLimit(admin, { studentId });
  if (dailyLimit.level === "reached") return null;

  const result = await withTraceAttributes(
    { userId: studentId, traceName },
    () => generateText(call),
  ).catch((error: unknown) => quotaAsNull(error, callFailed));
  if (!result) return null;
  await recordAiUsage(
    admin,
    {
      task,
      modelId: answeringModel(call, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );
  return result;
}

/**
 * A metered `embedMany` call (task `embed`): the vectors of `values`, in
 * order. `store` runs before the usage is recorded, so a failure in the
 * bookkeeping and the step's retry never pay for the stored vectors again.
 */
export async function meteredEmbed(
  admin: AdminSupabase,
  { studentId, traceName, callFailed }: MeteredScope,
  { values, maxRetries }: { values: string[]; maxRetries?: number },
  store?: (embeddings: number[][]) => Promise<void>,
): Promise<number[][] | null> {
  const dailyLimit = await checkDailyLimit(admin, { studentId });
  if (dailyLimit.level === "reached") return null;

  const settings = aiTask("embed");
  const result = await withTraceAttributes(
    { userId: studentId, traceName },
    () =>
      embedMany({
        ...settings,
        ...(maxRetries === undefined ? {} : { maxRetries }),
        values,
      }),
  ).catch((error: unknown) => quotaAsNull(error, callFailed));
  if (!result) return null;
  await store?.(result.embeddings);

  // A provider that reports no usage for embeddings makes `embedMany` sum
  // it to NaN: estimate it from the text then.
  const reported = Number.isFinite(result.usage.tokens);
  await recordAiUsage(
    admin,
    {
      task: "embed",
      modelId: settings.model,
      usage: reported
        ? {
            inputTokens: result.usage.tokens,
            cachedInputTokens: 0,
            outputTokens: 0,
          }
        : estimatedUsage({ input: values.join(""), output: "" }),
      estimated: !reported,
    },
    { studentId },
  );
  return result.embeddings;
}

/** Null for a used-up daily quota of the provider; otherwise the error. */
function quotaAsNull(
  error: unknown,
  callFailed: MeteredScope["callFailed"],
): null {
  if (isDailyQuotaError(error)) return null;
  if (callFailed) callFailed(error);
  throw error;
}
