import "server-only";
import {
  chapterExtractionMessages,
  chapterExtractionSchema,
  chapterExtractionSettings,
  type OfferedChunk,
} from "@/features/knowledge-map/ai/chapter-extraction";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  checkExtraction,
  type UnitExtraction,
} from "@/features/knowledge-map/domain/chapter-extraction";
import {
  MIN_UNIT_COVERAGE,
  unitCoverage,
} from "@/features/knowledge-map/domain/unit-coverage";
import {
  extractAttempts,
  loadCourseLanguage,
  loadCourseUnits,
  loadStoredUnits,
  planAttempts,
  touchBuild,
  unitKey,
  type CourseUnit,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  buildCall,
  RateLimited,
} from "@/features/knowledge-map/workflows/build-call";
import { RATE_LIMITED_STEP_RETRIES } from "@/features/usage/server";
import { retryTimeoutMs } from "@/lib/ai/call-timeout";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The extraction steps of a build: one call per teaching unit (task `map`)
 * whose content has no stored extraction, each stored as it finishes in
 * `chapter_extractions`, so a stopped build resumes without paying again.
 */

/**
 * Extracts up to UNITS_PER_STEP teaching units without a current
 * extraction, in Course order, as one round of at most AI_CONCURRENCY calls.
 * An answer whose KCs cite less than MIN_UNIT_COVERAGE of the unit is asked
 * once more with what is left of the step, and the answer that covers more
 * is stored; an answer with no KCs is stored as it is. A unit the rate
 * limit turned away is left to the next step, which the workflow starts
 * after the wait (`waitMs`). A unit whose call fails is left to the next
 * step and goes last; after its second failure it is called in pieces, halved again on
 * each failure, until it is given up (`domain/unit-pieces.ts`). So a failing
 * unit never fails the build. A reached Daily limit stops the build; what
 * is stored stays.
 */
export async function extractChapters(
  courseId: string,
  failed: readonly string[] = [],
): Promise<StepOutcome> {
  "use step";
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [units, stored] = await Promise.all([
    loadCourseUnits(supabase, courseId, "content"),
    loadStoredUnits(supabase, courseId),
  ]);
  const hashOf = new Map(stored.map((row) => [row.key, row.contentHash]));
  const todo = units.filter(
    (unit) => hashOf.get(unitKey(unit)) !== unit.contentHash,
  );
  const attempts = planAttempts(todo, stored, failed);
  if (attempts.length === 0) return { ok: true, left: 0 };

  const language = await loadCourseLanguage(supabase, courseId);
  const { done, failedKeys, limit, waitMs } = await extractAttempts(
    supabase,
    { owner, courseId },
    attempts,
    (unit, chunks) =>
      extractUnit(supabase, owner, { unit, chunks, language, startedAt }),
    startedAt,
  );
  if (limit) return { ok: false, reason: dailyLimitReason };
  return {
    ok: true,
    left: attempts.length - done,
    failed: failedKeys,
    waitMs,
  };
}

extractChapters.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * The extraction of a unit's chunks, all or a piece, checked: asked once
 * more when its KCs cite less than MIN_UNIT_COVERAGE of them and enough of
 * the step is left (`retryTimeoutMs`), the answer that covers more kept.
 * An answer with no KCs is kept without a retry: the unit teaches nothing.
 * "failed" when the first call gives no answer, "limit" when the Daily
 * limit stops the first call, `RateLimited` when the rate limit turns it
 * away.
 */
async function extractUnit(
  supabase: AdminSupabase,
  owner: string,
  {
    unit: whole,
    chunks,
    language,
    startedAt,
  }: {
    unit: CourseUnit;
    chunks: CourseUnit["chunks"];
    language: string;
    startedAt: number;
  },
): Promise<UnitExtraction | "limit" | "failed" | RateLimited> {
  const unit = { ...whole, chunks };
  const offered = unit.chunks.map((chunk, index): OfferedChunk => ({
    id: `c${index + 1}`,
    markdown: chunk.markdown,
  })) as [OfferedChunk, ...OfferedChunk[]];
  const offeredUnit = {
    material: unit.materialName,
    outline: unit.outline,
    language,
    chunks: offered,
  };
  const storedId = new Map(
    unit.chunks.map((chunk, index) => [offered[index]!.id, chunk.id]),
  );
  const call = async (timeoutMs?: number) => {
    const answer = await buildCall(
      supabase,
      { studentId: owner, task: "map", traceName: "extract-chapter" },
      {
        ...chapterExtractionSettings(offeredUnit),
        messages: chapterExtractionMessages(offeredUnit),
      },
      chapterExtractionSchema(),
      timeoutMs,
    );
    return typeof answer === "string" || answer instanceof RateLimited
      ? answer
      : checkExtraction(answer, storedId);
  };
  const coverage = (extraction: UnitExtraction) =>
    unitCoverage(
      unit.chunks,
      extraction.kcs.flatMap((kc) => kc.chunkIds),
    );

  const first = await call();
  if (typeof first === "string" || first instanceof RateLimited) return first;
  const retryMs = retryTimeoutMs(startedAt);
  if (
    first.kcs.length === 0 ||
    coverage(first) >= MIN_UNIT_COVERAGE ||
    retryMs === null
  ) {
    return first;
  }
  console.warn(
    `The extract-chapter call covered ${Math.round(coverage(first) * 100)}% of its unit; once more.`,
  );
  // A second call that fails, meets the Daily limit or the rate limit keeps
  // the first, valid answer; a limit then stops the next call.
  const second = await call(retryMs);
  if (typeof second === "string" || second instanceof RateLimited) {
    return first;
  }
  return coverage(second) > coverage(first) ? second : first;
}
