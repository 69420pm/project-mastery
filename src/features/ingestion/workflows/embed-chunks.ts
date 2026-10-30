import "server-only";
import { APICallError, RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { retryDelayMs } from "@/features/ingestion/ai/retry-delay";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import { meteredEmbed } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * Chunks embedded and stored per model call. Small batches store more of a
 * large Material before a failure pauses the step, and a retry loses little.
 */
const BATCH_SIZE = 20;

/** The wait before a retry when the provider names none. */
const DEFAULT_RETRY_MS = 60_000;

/**
 * Attempts of the step. A per-minute limit costs one attempt for each wait,
 * and a large Material takes several batches; the Workflow default is 3.
 */
const MAX_RETRIES = 30;

/**
 * The AI Gateway's own rate limit error, which is no `APICallError`, and the
 * wait its message names: "Retry after 20s."
 */
function gatewayRateLimit(error: unknown): { retryAfterMs: number } | null {
  if (!(error instanceof Error) || error.name !== "GatewayRateLimitError") {
    return null;
  }
  const seconds = Number.parseFloat(
    /retry after (\d+(?:\.\d+)?)s/i.exec(error.message)?.[1] ?? "",
  );
  return {
    retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_MS,
  };
}

/**
 * A failed embedding call, other than a used-up daily quota: the step's
 * error, so that the Workflow runtime is the one layer that retries: after
 * the delay the provider asks for when the call can succeed later (a
 * per-minute 429, a 503), and not at all when it cannot.
 */
function embedCallFailed(error: unknown): never {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const rateLimit = gatewayRateLimit(cause);
  if (rateLimit) {
    throw new RetryableError((cause as Error).message, {
      retryAfter: rateLimit.retryAfterMs,
    });
  }
  if (!APICallError.isInstance(cause)) throw error;
  if (!cause.isRetryable) throw new FatalError(cause.message);
  throw new RetryableError(cause.message, {
    retryAfter: retryDelayMs(cause) ?? DEFAULT_RETRY_MS,
  });
}

/**
 * The embed step of a parse (`parse-material.ts`): embeds the markdown of
 * every non-admin chunk that has no vector yet as a document (task `embed`;
 * admin chunks are never searched or paired) and stores
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
    .neq("label", "admin")
    .order("position");
  if (missing.error) failed("Loading the chunks to embed", missing.error);

  for (let start = 0; start < missing.data.length; start += BATCH_SIZE) {
    const batch = missing.data.slice(start, start + BATCH_SIZE);

    const embeddings = await meteredEmbed(
      supabase,
      { studentId, traceName: "parse-embed", callFailed: embedCallFailed },
      // The step retries, not the AI SDK as well: one request per attempt.
      {
        values: batch.map((chunk) => chunk.markdown),
        maxRetries: 0,
        asDocuments: true,
      },
      // One transaction per batch. pgvector reads the text form "[0.1,0.2]".
      async (vectors) => {
        const { error } = await supabase.rpc("set_chunk_embeddings", {
          p_embeddings: batch.map((chunk, index) => ({
            id: chunk.id,
            embedding: JSON.stringify(vectors[index]),
          })),
        });
        if (error) failed("Storing the chunk embeddings", error);
      },
    );
    if (!embeddings) return { ok: false, reason: dailyLimitReason };
  }
  return { ok: true };
}

embedChunks.maxRetries = MAX_RETRIES;
