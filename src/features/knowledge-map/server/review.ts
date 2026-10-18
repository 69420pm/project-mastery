import "server-only";
import { z } from "zod";
import { getMaterialList } from "@/features/courses/server";
import { getChunkPlaces } from "@/features/ingestion/server";
import { FINDING_KINDS } from "@/features/knowledge-map/schemas";
import type { ReviewFinding } from "@/features/knowledge-map/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The review queue: a Course's open Findings, which the Brief asks the
 * Student about one at a time. Every call runs as the Student whose session
 * client `supabase` is, so Row Level Security hides other Students' Findings.
 */

/**
 * The Course's open Findings in map order, each with its sources as
 * "<Material> p. N" in reading order and whether the Brief has asked it.
 */
export async function getOpenFindings(
  supabase: Supabase,
  courseId: string,
): Promise<ReviewFinding[]> {
  const [findings, sources, materials] = await Promise.all([
    supabase
      .from("findings")
      .select("id, kind, text, asked_at")
      .eq("course_id", courseId)
      .eq("status", "open")
      .order("position"),
    supabase
      .from("finding_sources")
      .select("finding_id, chunk_id")
      .eq("course_id", courseId),
    // Newest first; reading order is oldest first.
    getMaterialList(courseId, supabase).then((list) => list.toReversed()),
  ]);
  if (findings.error) failed("Loading the findings", findings.error);
  if (sources.error) failed("Loading the finding sources", sources.error);
  if (findings.data.length === 0) return [];

  const open = new Set(findings.data.map(({ id }) => id));
  const ownSources = sources.data.filter(({ finding_id }) =>
    open.has(finding_id),
  );
  const places = await getChunkPlaces(
    ownSources.map(({ chunk_id }) => chunk_id),
    supabase,
  );
  const materialOrder = new Map(materials.map(({ id }, i) => [id, i]));
  const materialName = new Map(materials.map((m) => [m.id, m.name]));
  const pagesOf = (findingId: string) => {
    const chunkIds = new Set(
      ownSources
        .filter(({ finding_id }) => finding_id === findingId)
        .map(({ chunk_id }) => chunk_id),
    );
    return [
      ...new Set(
        places
          .filter(({ id }) => chunkIds.has(id))
          .toSorted(
            (a, b) =>
              (materialOrder.get(a.materialId) ?? 0) -
                (materialOrder.get(b.materialId) ?? 0) ||
              a.position - b.position,
          )
          .map(
            (place) =>
              `${materialName.get(place.materialId) ?? "Material"} p. ${place.pageFrom}`,
          ),
      ),
    ];
  };

  return findings.data.map((finding) => ({
    id: finding.id,
    kind: z.enum(FINDING_KINDS).parse(finding.kind),
    text: finding.text,
    sources: pagesOf(finding.id),
    asked: finding.asked_at !== null,
  }));
}

/** Marks an open Finding of the Course as asked, unless it already is. */
export async function markFindingAsked(
  supabase: Supabase,
  courseId: string,
  findingId: string,
): Promise<void> {
  const { error } = await supabase
    .from("findings")
    .update({ asked_at: new Date().toISOString() })
    .eq("id", findingId)
    .eq("course_id", courseId)
    .is("asked_at", null);
  if (error) failed("Marking the finding as asked", error);
}

/**
 * Stores the Student's answer to a Finding of the Course, verbatim, and marks
 * it answered. False, and nothing changed, when the Finding is not the
 * Course's or is answered already: an answer once stored is never replaced.
 */
export async function answerFinding(
  supabase: Supabase,
  courseId: string,
  findingId: string,
  answer: string,
): Promise<boolean> {
  if (!z.uuid().safeParse(findingId).success) return false;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("findings")
    .update({ status: "answered", answer, answered_at: now })
    .eq("id", findingId)
    .eq("course_id", courseId)
    .eq("status", "open")
    .select("id");
  if (error) failed("Saving the answer", error);
  return data.length > 0;
}
