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
  buildCall,
  loadCourseLanguage,
  loadCourseUnits,
  loadStoredUnits,
  runCalls,
  stepOutcome,
  storeExtraction,
  touchBuild,
  unitKey,
  UNITS_PER_STEP,
  type CourseUnit,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { RATE_LIMITED_STEP_RETRIES } from "@/features/usage/server";
import { callFits } from "@/lib/ai/call-timeout";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The extraction steps of a build: one call per teaching unit (task `map`)
 * whose content has no stored extraction, each stored as it finishes in
 * `chapter_extractions`, so a stopped build resumes without paying again.
 */

/**
 * Extracts up to UNITS_PER_STEP teaching units without a current
 * extraction, in Course order, at most AI_CONCURRENCY calls at a time. An
 * answer whose KCs cite less than MIN_UNIT_COVERAGE of the unit is asked
 * once more, and the answer that covers more is stored. A unit whose call
 * fails is left to the next step, and fails the build when it failed once
 * before (`failedOnce`). A reached Daily limit stops the build; what is
 * stored stays.
 */
export async function extractChapters(
  courseId: string,
  failedOnce: readonly string[] = [],
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
  if (todo.length === 0) return { ok: true, left: 0 };

  const language = await loadCourseLanguage(supabase, courseId);
  let done = 0;
  let limitReached = false;
  const failedKeys: string[] = [];
  await runCalls(
    todo.slice(0, UNITS_PER_STEP),
    async (unit) => {
      const extraction = await extractUnit(supabase, owner, {
        unit,
        language,
        startedAt,
      });
      if (extraction === "limit") {
        limitReached = true;
        return "stop";
      }
      if (extraction === "failed") {
        failedKeys.push(unitKey(unit));
        return;
      }
      await storeExtraction(supabase, { owner, courseId, unit }, extraction);
      done += 1;
    },
    startedAt,
  );
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return stepOutcome(supabase, {
    left: todo.length - done,
    failedKeys,
    failedOnce,
  });
}

extractChapters.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * One unit's extraction, checked: asked once more when its KCs cite less
 * than MIN_UNIT_COVERAGE of the unit and a call still fits the step, the
 * answer that covers more kept. "failed" when the first call gives no
 * answer, "limit" when the Daily limit stops the first call.
 */
async function extractUnit(
  supabase: AdminSupabase,
  owner: string,
  {
    unit,
    language,
    startedAt,
  }: { unit: CourseUnit; language: string; startedAt: number },
): Promise<UnitExtraction | "limit" | "failed"> {
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
  const call = async () => {
    const answer = await buildCall(
      supabase,
      { studentId: owner, task: "map", traceName: "extract-chapter" },
      {
        ...chapterExtractionSettings(offeredUnit),
        messages: chapterExtractionMessages(offeredUnit),
      },
      chapterExtractionSchema(),
    );
    return typeof answer === "string"
      ? answer
      : checkExtraction(answer, storedId);
  };
  const coverage = (extraction: UnitExtraction) =>
    unitCoverage(
      unit.chunks,
      extraction.kcs.flatMap((kc) => kc.chunkIds),
    );

  const first = await call();
  if (typeof first === "string") return first;
  if (coverage(first) >= MIN_UNIT_COVERAGE || !callFits(startedAt)) {
    return first;
  }
  console.warn(
    `The extract-chapter call covered ${Math.round(coverage(first) * 100)}% of its unit; once more.`,
  );
  // A second call that fails or meets the Daily limit keeps the first,
  // valid answer; the limit then stops the build at the next call.
  const second = await call();
  if (typeof second === "string") return first;
  return coverage(second) > coverage(first) ? second : first;
}
