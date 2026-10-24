import type { KcView, KnowledgeMapView } from "@/features/knowledge-map/types";

/**
 * The map a Topic page draws (#176): the Topic's KCs in their Big ideas, its
 * anchors as prior knowledge (they sit outside the Topic, so they have no
 * group), the Exercises that test a Topic KC, and the links among the KCs
 * shown. An Exercise lists only the shown KCs it tests. Pure code.
 */
export function restrictMapToTopic(
  map: KnowledgeMapView,
  topic: { kcs: Array<{ id: string }>; anchors: Array<{ id: string }> },
): KnowledgeMapView {
  const inside = new Set(topic.kcs.map((kc) => kc.id));
  const anchorIds = new Set(topic.anchors.map((kc) => kc.id));
  const shown = new Set([...inside, ...anchorIds]);
  const anchors: KcView[] = [
    ...map.bigIdeas.flatMap((bigIdea) => bigIdea.kcs),
    ...map.priorKnowledge,
  ].filter((kc) => anchorIds.has(kc.id) && !inside.has(kc.id));
  const among = <T extends { from: string; to: string }>(links: T[]) =>
    links.filter((link) => shown.has(link.from) && shown.has(link.to));

  return {
    ...map,
    bigIdeas: map.bigIdeas
      .map((bigIdea) => ({
        ...bigIdea,
        kcs: bigIdea.kcs.filter((kc) => inside.has(kc.id)),
      }))
      .filter((bigIdea) => bigIdea.kcs.length > 0),
    priorKnowledge: anchors,
    prerequisites: among(map.prerequisites),
    semanticLinks: among(map.semanticLinks),
    exercises: map.exercises
      .filter((exercise) => exercise.kcs.some((id) => inside.has(id)))
      .map((exercise) => ({
        ...exercise,
        kcs: exercise.kcs.filter((id) => shown.has(id)),
      })),
  };
}
