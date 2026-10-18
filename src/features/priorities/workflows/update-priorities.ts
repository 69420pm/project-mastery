import { adjustmentOf } from "@/features/priorities/domain/adjustment";
import { priorities } from "@/features/priorities/domain/priority";
import {
  adjustPriorities,
  failRun,
  loadRunInput,
  storePriorities,
} from "@/features/priorities/workflows/priority-steps";

/** Why a run failed, for the Student. */
const runFailedReason = "The priorities could not be computed.";

/**
 * Computes the Priority of every KC of a Course whose run
 * `queue_priority_run` has moved to `running` (#86): code computes each
 * base from old exams, Exercises and the prerequisite graph, and the
 * multiplier is the code exclusion (0 for KCs only Materials excluded in the
 * Brief teach) times the model's adjustment from the Brief's notes and the
 * answered Findings. The model is asked only when those or the map changed
 * since its last adjustment; otherwise the stored one is reused, and with
 * neither notes nor answered Findings every adjustment is 1. A reached
 * Daily limit reuses the stored adjustment and leaves `adjusted_at`, so the
 * next run asks again. The result replaces the Course's priorities in one
 * transaction. A failure marks the run failed and keeps the previous
 * priorities. A deleted Course stops it quietly.
 */
export async function updatePriorities(courseId: string): Promise<void> {
  "use workflow";
  try {
    const run = await loadRunInput(courseId);
    if (!run) return;
    let entries = run.plan === "skip" ? [] : run.storedAdjustments;
    let adjustments = run.plan === "skip" ? entries : null;
    if (run.plan === "call" && run.adjust.kcs.length > 0) {
      const answer = await adjustPriorities(run.studentId, run.adjust);
      if (answer) entries = adjustments = answer;
    }
    await storePriorities(
      courseId,
      priorities(
        run.input,
        new Set(run.excludedMaterialIds),
        adjustmentOf(entries, run.adjust.kcs),
      ),
      adjustments,
    );
  } catch (error) {
    console.error("Updating the priorities failed:", error);
    await failRun(courseId, runFailedReason);
  }
}
