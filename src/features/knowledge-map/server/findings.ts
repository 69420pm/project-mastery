import "server-only";
import { z } from "zod";
import { getMaterialList, materialChunksPath } from "@/features/courses/server";
import { chunkAnchor, getChunkPlaces } from "@/features/ingestion/server";
import { FINDING_STATUSES } from "@/features/knowledge-map/schemas";
import type { FindingView } from "@/features/knowledge-map/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

function failed(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/**
 * Every Finding of the signed-in Student's Course, open ones first and each
 * group in map order, with its sources as links to their chunks. Row Level
 * Security scopes every read; an unknown Course has none.
 */
export async function getFindings(courseId: string): Promise<FindingView[]> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return [];
  const supabase = await createClient();

  const [findings, sources, materials] = await Promise.all([
    supabase
      .from("findings")
      .select("id, text, status, answer, asked_at, answered_at")
      .eq("course_id", courseId)
      .order("position"),
    supabase
      .from("finding_sources")
      .select("finding_id, chunk_id")
      .eq("course_id", courseId),
    getMaterialList(courseId),
  ]);
  if (findings.error) failed("Loading the findings", findings.error);
  if (sources.error) failed("Loading the finding sources", sources.error);

  const places = await getChunkPlaces([
    ...new Set(sources.data.map((source) => source.chunk_id)),
  ]);
  const placeOf = new Map(places.map((place) => [place.id, place]));
  const materialName = new Map(materials.map((m) => [m.id, m.name]));

  const views = findings.data.map((finding): FindingView => {
    const chunks = sources.data
      .filter((source) => source.finding_id === finding.id)
      .flatMap((source) => placeOf.get(source.chunk_id) ?? []);
    return {
      id: finding.id,
      text: finding.text,
      status: z.enum(FINDING_STATUSES).parse(finding.status),
      askedAt: finding.asked_at,
      answeredAt: finding.answered_at,
      answer: finding.answer,
      sources: chunks.map((place) => ({
        label: `${materialName.get(place.materialId) ?? "Material"} p. ${place.pageFrom}`,
        href: `${materialChunksPath(courseId, place.materialId)}#${chunkAnchor(place.id)}`,
      })),
    };
  });
  return [
    ...views.filter((finding) => finding.status === "open"),
    ...views.filter((finding) => finding.status !== "open"),
  ];
}
