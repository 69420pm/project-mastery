import { priorities } from "@/features/priorities/domain/priority";
import {
  failRun,
  loadRunInput,
  storePriorities,
} from "@/features/priorities/workflows/priority-steps";

/** Why a run failed, for the Student. */
export const runFailedReason = "The priorities could not be computed.";

/**
 * Computes the Priority of every KC of a Course whose run
 * `queue_priority_run` has moved to `running` (#86): code computes each
 * base from old exams, Exercises and the prerequisite graph, and the
 * multiplier is 1 apart from KCs only Materials excluded in the Brief
 * teach, which get 0. The result replaces the Course's priorities in one
 * transaction. A failure marks the run failed and keeps the previous
 * priorities. A deleted Course stops it quietly.
 */
export async function updatePriorities(courseId: string): Promise<void> {
  "use workflow";
  try {
    const run = await loadRunInput(courseId);
    if (!run) return;
    await storePriorities(
      courseId,
      priorities(run.input, new Set(run.excludedMaterialIds)),
    );
  } catch (error) {
    console.error("Updating the priorities failed:", error);
    await failRun(courseId, runFailedReason);
  }
}
