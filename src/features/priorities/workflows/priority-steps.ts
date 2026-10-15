import "server-only";
import { loadBriefForPriorities } from "@/features/brief/server";
import { loadStoredMap } from "@/features/knowledge-map/server";
import type {
  KcPriority,
  PriorityInput,
} from "@/features/priorities/domain/priority";
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

/** What a run reads once: the map, the Course's chunks and Materials, the Brief. */
export type RunInput = {
  input: PriorityInput;
  excludedMaterialIds: string[];
};

/**
 * The stored map, the points and Materials of the Course's chunks, and the
 * Brief's excluded Materials of the Course whose run is running. Null when
 * no run runs any more, as when the Course was deleted.
 */
export async function loadRunInput(courseId: string): Promise<RunInput | null> {
  "use step";
  const supabase = createAdminClient();
  const run = await supabase
    .from("priority_runs")
    .select("owner")
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
  const [map, chunks, materials, brief] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadChunks(),
    supabase
      .from("materials")
      .select("id, name, is_exam")
      .eq("course_id", courseId),
    loadBriefForPriorities(supabase, courseId),
  ]);
  if (materials.error) fail("Loading the Materials", materials.error);

  return {
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
  };
}

/**
 * Replaces the Course's KC priorities and marks the run done, in one
 * transaction. Does nothing when no run runs any more.
 */
export async function storePriorities(
  courseId: string,
  priorities: KcPriority[],
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_kc_priorities", {
    p_course_id: courseId,
    p_priorities: priorities,
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
