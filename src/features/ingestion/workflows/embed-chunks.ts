import "server-only";
import { embedMany } from "ai";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  dailyQuotaAsNull,
  fail,
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { aiTask } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTraceAttributes } from "@/lib/tracing";

/** Chunks embedded and stored per model call, so a retry loses little. */
const BATCH_SIZE = 50;

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
    const result = await withTraceAttributes(
      { userId: studentId, traceName: "parse-embed" },
      () =>
        embedMany({
          ...settings,
          values: batch.map((chunk) => chunk.markdown),
        }),
    ).catch(dailyQuotaAsNull);
    if (!result) return { ok: false, reason: dailyLimitReason };
    await recordAiUsage(
      supabase,
      {
        task: "embed",
        modelId: settings.model,
        usage: {
          inputTokens: result.usage.tokens,
          cachedInputTokens: 0,
          outputTokens: 0,
        },
      },
      { studentId },
    );

    // One transaction per batch. pgvector reads the text form "[0.1,0.2]".
    const { error } = await supabase.rpc("set_chunk_embeddings", {
      p_embeddings: batch.map((chunk, index) => ({
        id: chunk.id,
        embedding: JSON.stringify(result.embeddings[index]),
      })),
    });
    if (error) fail("Storing the chunk embeddings", error);
  }
  return { ok: true };
}
