import type { KnowledgeMapView } from "@/features/knowledge-map/types";

/**
 * The map a Topic page draws (#176): the Topic's KCs and its anchors in
 * their Big ideas, the Exercises that test a Topic KC, and the Prerequisites
 * among the KCs shown. An Exercise lists only the shown KCs it tests. Pure
 * code.
 */
export function restrictMapToTopic(
  map: KnowledgeMapView,
  topic: { kcs: Array<{ id: string }>; anchors: Array<{ id: string }> },
): KnowledgeMapView {
  const inside = new Set(topic.kcs.map((kc) => kc.id));
  const shown = new Set([...inside, ...topic.anchors.map((kc) => kc.id)]);

  return {
    ...map,
    bigIdeas: map.bigIdeas
      .map((bigIdea) => ({
        ...bigIdea,
        kcs: bigIdea.kcs.filter((kc) => shown.has(kc.id)),
      }))
      .filter((bigIdea) => bigIdea.kcs.length > 0),
    prerequisites: map.prerequisites.filter(
      (link) => shown.has(link.from) && shown.has(link.to),
    ),
    exercises: map.exercises
      .filter((exercise) => exercise.kcs.some((id) => inside.has(id)))
      .map((exercise) => ({
        ...exercise,
        kcs: exercise.kcs.filter((id) => shown.has(id)),
      })),
  };
}
