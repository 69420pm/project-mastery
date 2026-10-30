import "server-only";
import { embedMany, generateText } from "ai";
import { RetryableError } from "workflow";
import { checkDailyLimit } from "@/features/usage/server/daily-limit";
import {
  recordAiUsage,
  type AdminStudentScope,
} from "@/features/usage/server/usage-store";
import { estimatedUsage, tokenUsage } from "@/lib/ai/cost";
import { isDailyQuotaError } from "@/lib/ai/daily-quota";
import {
  aiTask,
  answeringModel,
  EMBED_AS_DOCUMENTS,
  type AiTask,
} from "@/lib/ai/models";
import { gatewayRateLimitWaitMs } from "@/lib/ai/rate-limit";
import type {
  AdminSupabase,
  SessionSupabase,
  Supabase,
} from "@/lib/supabase/types";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * Attempts for a step that makes metered calls (`fn.maxRetries`). The
 * Gateway's per-minute rate limit costs one attempt for each wait, and a
 * step makes several calls; the Workflow default is 3.
 */
export const RATE_LIMITED_STEP_RETRIES = 30;

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

/** A generate call's scope; `dailyLimit: "ignore"` makes it past the limit. */
type GenerateScope = MeteredScope & {
  task: AiTask;
  dailyLimit?: "enforce" | "ignore";
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
  {
    studentId,
    task,
    traceName,
    callFailed,
    dailyLimit = "enforce",
  }: GenerateScope,
  call: GenerateCall,
): Promise<{ readonly output: unknown } | null> {
  if (dailyLimit === "enforce") {
    const limit = await checkDailyLimit(admin, { studentId });
    if (limit.level === "reached") return null;
  }

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
 * What to embed: `asDocuments` embeds the values as documents to be
 * searched (chunks), not as search queries.
 */
type EmbedCall = {
  values: string[];
  maxRetries?: number;
  asDocuments?: boolean;
};

/**
 * A metered `embedMany` call (task `embed`): the vectors of `values`, in
 * order. `store` runs before the usage is recorded, so a failure in the
 * bookkeeping and the step's retry never pay for the stored vectors again.
 */
export async function meteredEmbed(
  admin: AdminSupabase,
  scope: MeteredScope,
  call: EmbedCall,
  store?: (embeddings: number[][]) => Promise<void>,
): Promise<number[][] | null>;
/** With the Student's session client, usage is theirs by Row Level Security. */
export async function meteredEmbed(
  supabase: SessionSupabase,
  scope: Omit<MeteredScope, "studentId">,
  call: EmbedCall,
  store?: (embeddings: number[][]) => Promise<void>,
): Promise<number[][] | null>;
export async function meteredEmbed(
  admin: Supabase,
  {
    studentId,
    traceName,
    callFailed,
  }: Omit<MeteredScope, "studentId"> & { studentId?: string },
  { values, maxRetries, asDocuments }: EmbedCall,
  store?: (embeddings: number[][]) => Promise<void>,
): Promise<number[][] | null> {
  // `checkDailyLimit` and `recordAiUsage` refuse the admin client without a
  // Student id, whatever the overload the caller used.
  const scope = { studentId } as AdminStudentScope;
  const dailyLimit = await checkDailyLimit(admin as AdminSupabase, scope);
  if (dailyLimit.level === "reached") return null;

  const settings = aiTask("embed");
  const result = await withTraceAttributes(
    { userId: studentId, traceName },
    () =>
      embedMany({
        ...settings,
        ...(maxRetries === undefined ? {} : { maxRetries }),
        ...(asDocuments && {
          providerOptions: {
            ...settings.providerOptions,
            ...EMBED_AS_DOCUMENTS,
          },
        }),
        values,
      }),
  ).catch((error: unknown) => quotaAsNull(error, callFailed));
  if (!result) return null;
  await store?.(result.embeddings);

  // A provider that reports no usage for embeddings makes `embedMany` sum
  // it to NaN: estimate it from the text then.
  const reported = Number.isFinite(result.usage.tokens);
  await recordAiUsage(
    admin as AdminSupabase,
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
    scope,
  );
  return result.embeddings;
}

/**
 * Null for a used-up daily quota of the provider. The Gateway's per-minute
 * rate limit is the step's retry after the wait it names, before any
 * `callFailed`, since no later attempt of the step is a failure of the call.
 * Otherwise the error.
 */
function quotaAsNull(
  error: unknown,
  callFailed: MeteredScope["callFailed"],
): null {
  if (isDailyQuotaError(error)) return null;
  const waitMs = gatewayRateLimitWaitMs(error);
  if (waitMs !== null) {
    throw new RetryableError(String(error), { retryAfter: waitMs });
  }
  if (callFailed) callFailed(error);
  throw error;
}
