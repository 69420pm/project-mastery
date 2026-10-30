import "server-only";
import {
  topicAnchors,
  type loadStoredMap,
  type loadReadingSections,
} from "@/features/knowledge-map/server";
import { fitText } from "@/features/study/domain/plan";
import type { TodayTopic } from "@/features/study/domain/today";
import type { loadPlan } from "@/features/study/server/plan";
import { readingLabel } from "@/features/study/server/source-view";
import type { TutorToday } from "@/features/study/types";

/**
 * Today's work as the AI is told of it: the Topic `next` (the session's, or
 * the plan's next) with its KCs and anchors from the map and its Reading
 * sections, the hint and the fit line.
 */
export function tutorToday(
  plan: Awaited<ReturnType<typeof loadPlan>>,
  next: TodayTopic | null,
  map: Awaited<ReturnType<typeof loadStoredMap>>,
  schedules: Map<string, unknown>,
  readings: Awaited<ReturnType<typeof loadReadingSections>>,
): TutorToday {
  const { hint } = plan.today;
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  return {
    next: next && {
      id: next.id,
      name: next.name,
      centralQuestion: next.centralQuestion,
      kcs: next.kcs.flatMap((id) => {
        const kc = kcById.get(id);
        return kc
          ? [{ id, name: kc.name, type: kc.type, taught: schedules.has(id) }]
          : [];
      }),
      anchors: topicAnchors(next.kcs, map),
      readingSections: (readings.get(next.id) ?? []).map((section) => ({
        id: section.id,
        label: readingLabel(section),
      })),
    },
    hint,
    fitLine:
      plan.phase === null || plan.fit === null
        ? null
        : fitText(plan.phase, plan.fit),
  };
}
