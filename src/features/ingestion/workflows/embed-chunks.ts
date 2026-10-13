import "server-only";
import { APICallError, embedMany, RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { retryDelayMs } from "@/features/ingestion/ai/retry-delay";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  fail,
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { estimatedUsage } from "@/lib/ai/cost";
import { isDailyQuotaError } from "@/lib/ai/daily-quota";
import { aiTask } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * Chunks embedded and stored per model call. The Gemini API counts each
 * chunk as a request against its per-minute quota (100 on the free tier),
 * so small batches store more of a large Material before a 429 pauses it.
 */
const BATCH_SIZE = 20;

/** The wait before a retry when the provider names none. */
const DEFAULT_RETRY_MS = 60_000;

/**
 * A failed embedding call: null for a used-up daily quota of the provider.
 * Otherwise the step's error, so that the Workflow runtime is the one layer
 * that retries: after the delay the provider asks for when the call can
 * succeed later (a per-minute 429, a 503), and not at all when it cannot.
 */
function embedCallFailed(error: unknown): null {
  if (isDailyQuotaError(error)) return null;
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause)) throw error;
  if (!cause.isRetryable) throw new FatalError(cause.message);
  throw new RetryableError(cause.message, {
    retryAfter: retryDelayMs(cause) ?? DEFAULT_RETRY_MS,
  });
}

/**
 * The embed step of a parse (step 4 of `parse-material.ts`): embeds the
 * markdown of every chunk that has no vector yet (task `embed`) and stores
 * the vectors, so a retry after a failure resumes with the chunks still
 * missing one. Each batch checks the Daily limit and records usage for the
 * Material's Student; a reached limit ends the step with that reason.
 */
export async function embedChunks(materialId: string): Promise<ParseOutcome> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return { ok: true };
  const studentId = material.owner;

  const missing = await supabase
    .from("chunks")
    .select("id, markdown")
    .eq("material_id", materialId)
    .is("embedding", null)
    .order("position");
  if (missing.error) fail("Loading the chunks to embed", missing.error);

  for (let start = 0; start < missing.data.length; start += BATCH_SIZE) {
    const batch = missing.data.slice(start, start + BATCH_SIZE);

    const dailyLimit = await checkDailyLimit(supabase, { studentId });
    if (dailyLimit.level === "reached") {
      return { ok: false, reason: dailyLimitReason };
    }

    const settings = aiTask("embed");
    const values = batch.map((chunk) => chunk.markdown);
    const result = await withTraceAttributes(
      { userId: studentId, traceName: "parse-embed" },
      // The step retries, not the AI SDK as well: one request per attempt.
      () => embedMany({ ...settings, maxRetries: 0, values }),
    ).catch(embedCallFailed);
    if (!result) return { ok: false, reason: dailyLimitReason };

    // Stored before the usage is recorded, so a failure in the bookkeeping
    // and the step's retry never pay for these vectors again. One
    // transaction per batch. pgvector reads the text form "[0.1,0.2]".
    const { error } = await supabase.rpc("set_chunk_embeddings", {
      p_embeddings: batch.map((chunk, index) => ({
        id: chunk.id,
        embedding: JSON.stringify(result.embeddings[index]),
      })),
    });
    if (error) fail("Storing the chunk embeddings", error);

    // The Gemini API reports no usage for embeddings, which `embedMany`
    // sums to NaN: estimate it from the text then.
    const reported = Number.isFinite(result.usage.tokens);
    await recordAiUsage(
      supabase,
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
  }
  return { ok: true };
}
