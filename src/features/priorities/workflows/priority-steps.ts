import "server-only";
import { z } from "zod";
import {
  loadBriefForPriorities,
  type BriefForPriorities,
} from "@/features/brief/server";
import { loadChunkPoints, type ChunkPoints } from "@/features/ingestion/server";
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

/** A stored adjustment; a malformed one counts as none. */
const storedAdjustmentsSchema = z
  .array(
    z.object({ id: z.string(), multiplier: z.number(), reason: z.string() }),
  )
  .catch([]);

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

  const [map, chunks, brief] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadChunkPoints(supabase, courseId),
    loadBriefForPriorities(supabase, courseId),
  ]);
  return runInput({ run: run.data, map, chunks, brief });
}

/** A run's input from what `loadRunInput` read. */
function runInput({
  run,
  map,
  chunks,
  brief,
}: {
  run: { owner: string; adjusted_at: string | null; adjustments: unknown };
  map: Awaited<ReturnType<typeof loadStoredMap>>;
  chunks: ChunkPoints[];
  brief: BriefForPriorities;
}): RunInput {
  const answered = map.answeredFindings;
  const notes = brief.notes?.trim() ? brief.notes : null;
  return {
    studentId: run.owner,
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
          { materialId: chunk.materialId, points: chunk.points },
        ]),
      ),
      materials: Object.fromEntries(
        chunks.map((chunk) => [
          chunk.materialId,
          { name: chunk.materialName, isExam: chunk.isExam },
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
      mapFinishedAt: map.buildFinishedAt,
      adjustedAt: run.adjusted_at,
    }),
    storedAdjustments: storedAdjustmentsSchema.parse(run.adjustments),
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
