import "server-only";
import { loadBriefForPriorities } from "@/features/brief/server";
import { loadStoredMap } from "@/features/knowledge-map/server";
import {
  adjustCall,
  type AdjustInput,
} from "@/features/priorities/ai/adjust-call";
import {
  adjustmentPlan,
  type AdjustmentEntry,
  type AdjustmentPlan,
} from "@/features/priorities/domain/adjustment";
import type {
  KcPriority,
  PriorityInput,
} from "@/features/priorities/domain/priority";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The steps of a priority run (`update-priorities.ts`). Each runs on the
 * admin client, since no Student is signed in, and so scopes every query to
 * the Course itself.
 */

const PAGE = 1000;

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/**
 * What a run reads once: the map, the Course's chunks and Materials, the
 * Brief, the answered Findings, and the stored adjustment.
 */
export type RunInput = {
  studentId: string;
  input: PriorityInput;
  excludedMaterialIds: string[];
  /** What the model call reads. */
  adjust: AdjustInput;
  /** Whether the run asks the model, reuses `storedAdjustments`, or neither. */
  plan: AdjustmentPlan;
  storedAdjustments: AdjustmentEntry[];
};

/**
 * The stored map, the points and Materials of the Course's chunks, the
 * Brief and the answered Findings of the Course whose run is running. Null
 * when no run runs any more, as when the Course was deleted.
 */
export async function loadRunInput(courseId: string): Promise<RunInput | null> {
  "use step";
  const supabase = createAdminClient();
  const run = await supabase
    .from("priority_runs")
    .select("owner, adjusted_at, adjustments")
    .eq("course_id", courseId)
    .eq("status", "running")
    .maybeSingle();
  if (run.error) fail("Loading the priority run", run.error);
  if (!run.data) return null;

  const loadChunks = async () => {
    const rows: Array<{
      id: string;
      material_id: string;
      points: number | null;
    }> = [];
    for (let from = 0; ; from += PAGE) {
      const page = await supabase
        .from("chunks")
        .select("id, material_id, points")
        .eq("course_id", courseId)
        .order("id")
        .range(from, from + PAGE - 1);
      if (page.error) fail("Loading the chunks", page.error);
      rows.push(...page.data);
      if (page.data.length < PAGE) return rows;
    }
  };
  const [map, chunks, materials, brief, findings, build] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadChunks(),
    supabase
      .from("materials")
      .select("id, name, is_exam")
      .eq("course_id", courseId),
    loadBriefForPriorities(supabase, courseId),
    supabase
      .from("findings")
      .select("text, answer, answered_at")
      .eq("course_id", courseId)
      .eq("status", "answered")
      .order("position"),
    supabase
      .from("knowledge_map_builds")
      .select("finished_at")
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (materials.error) fail("Loading the Materials", materials.error);
  if (findings.error) fail("Loading the answered Findings", findings.error);
  if (build.error) fail("Loading the map build", build.error);

  const answered = findings.data.flatMap(({ text, answer, answered_at }) =>
    answer !== null && answered_at !== null
      ? [{ text, answer, answeredAt: answered_at }]
      : [],
  );
  const notes = brief.notes?.trim() ? brief.notes : null;
  return {
    studentId: run.data.owner,
    input: {
      kcs: map.kcs.map((kc) => ({
        id: kc.id,
        prior: kc.origin === "prior",
        sources: kc.sources,
      })),
      prerequisites: map.prerequisites.map(({ from, to }) => ({ from, to })),
      exercises: map.exercises.map((exercise) => ({
        questionChunk: exercise.questionChunk,
        kcs: exercise.kcs,
      })),
      chunks: Object.fromEntries(
        chunks.map((chunk) => [
          chunk.id,
          {
            materialId: chunk.material_id,
            points: chunk.points === null ? null : Number(chunk.points),
          },
        ]),
      ),
      materials: Object.fromEntries(
        materials.data.map((material) => [
          material.id,
          { name: material.name, isExam: material.is_exam === true },
        ]),
      ),
    },
    excludedMaterialIds: brief.excludedMaterialIds,
    adjust: {
      notes,
      findings: answered.map(({ text, answer }) => ({ text, answer })),
      bigIdeas: map.bigIdeas.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
      kcs: map.kcs.map((kc) => ({
        id: kc.id,
        name: kc.name,
        description: kc.description,
        bigIdea: kc.bigIdea,
      })),
    },
    plan: adjustmentPlan({
      hasNotes: notes !== null,
      answeredAt: answered.map(({ answeredAt }) => answeredAt),
      notesUpdatedAt: brief.notesUpdatedAt,
      mapFinishedAt: build.data?.finished_at ?? null,
      adjustedAt: run.data.adjusted_at,
    }),
    storedAdjustments: run.data.adjustments as AdjustmentEntry[],
  };
}

/**
 * The model's adjustment for the Student, after checking their Daily limit,
 * with its usage recorded. Null when the Daily limit or the provider's daily
 * quota is used up.
 */
export async function adjustPriorities(
  studentId: string,
  input: AdjustInput,
): Promise<AdjustmentEntry[] | null> {
  "use step";
  const { call, entries } = adjustCall(input);
  const result = await meteredGenerate(
    createAdminClient(),
    { studentId, task: "priority", traceName: "priority-adjust" },
    call,
  );
  return result && entries(result.output);
}

/**
 * Replaces the Course's KC priorities and marks the run done, in one
 * transaction, storing `adjustments` as the model's last adjustment unless
 * it is null. Does nothing when no run runs any more.
 */
export async function storePriorities(
  courseId: string,
  priorities: KcPriority[],
  adjustments: AdjustmentEntry[] | null,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_kc_priorities", {
    p_course_id: courseId,
    p_priorities: priorities,
    ...(adjustments && { p_adjustments: adjustments }),
  });
  if (error) fail("Storing the priorities", error);
}

/** Marks the running run failed with a reason for the Student. */
export async function failRun(courseId: string, reason: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("priority_runs")
    .update({ status: "failed", failure_reason: reason })
    .eq("course_id", courseId)
    .eq("status", "running");
  if (error) fail("Recording the failed priority run", error);
}
