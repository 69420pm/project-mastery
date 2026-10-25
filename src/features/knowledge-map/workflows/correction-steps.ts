import "server-only";
import {
  correctionsCall,
  correctionsSchema,
} from "@/features/knowledge-map/ai/correction-calls";
import type {
  CorrectionAnswer,
  MapCorrection,
} from "@/features/knowledge-map/domain/corrections";
import { aliases } from "@/features/knowledge-map/domain/update";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";
import {
  limitReached,
  mapCall,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The corrections step's steps (#181), on the admin client and scoped to
 * the Course: the accepted map Findings, the `correctMap` call, and marking
 * them applied right after the map is stored.
 */

/** The Course's accepted map Findings, oldest first, with their chunks. */
export async function loadCorrections(
  courseId: string,
): Promise<MapCorrection[]> {
  "use step";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("map_findings")
    .select("id, kind, kc_id, linked_kc_id, chunk_id, quote, reason")
    .eq("course_id", courseId)
    .eq("status", "accepted")
    .order("created_at");
  if (error) failed("Loading the accepted map Findings", error);
  if (data.length === 0) return [];
  const chunks = await supabase
    .from("chunks")
    .select("id, markdown")
    .eq("course_id", courseId)
    .in("id", [...new Set(data.map((row) => row.chunk_id))]);
  if (chunks.error) failed("Loading the quoted chunks", chunks.error);
  const markdown = new Map(chunks.data.map((row) => [row.id, row.markdown]));
  return data.map((row) => ({
    id: row.id,
    kind: row.kind as MapCorrection["kind"],
    kcId: row.kc_id,
    linkedKcId: row.linked_kc_id,
    quote: row.quote,
    reason: row.reason,
    chunk: markdown.get(row.chunk_id) ?? "",
  }));
}

/**
 * The corrections call over the accepted Findings whose KCs are on the map,
 * with each one's KCs and the links between them. Findings and KCs go to
 * the model by short local ids; the answers come back by the map's ids.
 */
export async function correctMap(
  studentId: string,
  map: KnowledgeMap,
  corrections: MapCorrection[],
): Promise<StepOutcome<Record<string, CorrectionAnswer>>> {
  "use step";
  const findingIds = aliases(
    corrections.map((finding) => finding.id),
    "f",
  );
  const kcIds = aliases(
    map.kcs.map((kc) => kc.id),
    "k",
  );
  const kcView = (id: string) => {
    const kc = map.kcs.find((item) => item.id === id);
    return {
      id: kcIds.local(id),
      name: kc?.name ?? id,
      description: kc?.description ?? "",
    };
  };
  const between =
    (finding: MapCorrection) => (link: { from: string; to: string }) => {
      const ends = [finding.kcId, finding.linkedKcId];
      return ends.includes(link.from) && ends.includes(link.to);
    };
  const output = await mapCall(
    studentId,
    "map-corrections",
    correctionsCall(
      corrections.map((finding) => ({
        id: findingIds.local(finding.id),
        kind: finding.kind,
        kc: kcView(finding.kcId),
        linkedKc:
          finding.linkedKcId === null ? null : kcView(finding.linkedKcId),
        links: [
          ...map.prerequisites.filter(between(finding)).map((link) => ({
            type: "prerequisite" as const,
            from: kcIds.local(link.from),
            to: kcIds.local(link.to),
          })),
          ...map.semanticLinks.filter(between(finding)).map((link) => ({
            type: "semantic" as const,
            from: kcIds.local(link.from),
            to: kcIds.local(link.to),
            coreType: link.coreType,
            label: link.label,
          })),
        ],
        reason: finding.reason,
        quote: finding.quote,
        chunk: finding.chunk,
      })),
    ),
  );
  if (output === null) return limitReached;
  const parsed = correctionsSchema(
    corrections.map((finding) => findingIds.local(finding.id)),
  ).parse(output);
  const real = <Link extends { from: string; to: string }>(link: Link) => ({
    ...link,
    from: kcIds.real(link.from),
    to: kcIds.real(link.to),
  });
  return {
    ok: true,
    value: Object.fromEntries(
      Object.entries(parsed.findings).map(([id, answer]) => [
        findingIds.real(id),
        {
          outcome: answer.outcome,
          addPrerequisites: answer.addPrerequisites.map(real),
          removePrerequisites: answer.removePrerequisites.map(real),
          addSemanticLinks: answer.addSemanticLinks.map(real),
          removeSemanticLinks: answer.removeSemanticLinks.map(real),
          descriptions: answer.descriptions.map((change) => ({
            ...change,
            kcId: kcIds.real(change.kcId),
          })),
        },
      ]),
    ),
  };
}

/**
 * Marks the applied Findings with their outcomes, once the map that applies
 * them is stored. Only a Finding still accepted changes; one whose KC the
 * update merged or dropped went with it.
 */
export async function markCorrectionsApplied(
  courseId: string,
  outcomes: Array<{ id: string; outcome: string }>,
): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  for (const { id, outcome } of outcomes) {
    const { error } = await supabase
      .from("map_findings")
      .update({ status: "applied", outcome })
      .eq("course_id", courseId)
      .eq("id", id)
      .eq("status", "accepted");
    if (error) failed("Marking the map Finding applied", error);
  }
}
