import "server-only";
import { z } from "zod";
import type { MapFindingKind, MapFindingView } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Map Findings the tutor files with `flagMap`, written and read as the
 * Student. Accepting one applies it to the map in the database.
 */

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** A chunk of the Course's Markdown; null for any other id. */
export async function findCourseChunk(
  supabase: Supabase,
  courseId: string,
  chunkId: string,
): Promise<{ markdown: string } | null> {
  // Ids the model made up are no uuids, which the query would refuse.
  if (!isUuid(chunkId)) return null;
  const { data, error } = await supabase
    .from("chunks")
    .select("markdown")
    .eq("course_id", courseId)
    .eq("id", chunkId)
    .maybeSingle();
  if (error) failed("Loading the chunk", error);
  return data;
}

/** Stores an open map Finding in a Study session; returns its id. */
export async function insertMapFinding(
  supabase: Supabase,
  finding: {
    courseId: string;
    sessionId: string;
    kind: MapFindingKind;
    kcId: string;
    linkedKcId: string | null;
    proposedDescription: string | null;
    chunkId: string;
    quote: string;
    reason: string;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("map_findings")
    .insert({
      course_id: finding.courseId,
      study_session_id: finding.sessionId,
      kind: finding.kind,
      kc_id: finding.kcId,
      linked_kc_id: finding.linkedKcId,
      proposed_description: finding.proposedDescription,
      chunk_id: finding.chunkId,
      quote: finding.quote,
      reason: finding.reason,
    })
    .select("id")
    .single();
  if (error) failed("Saving the map Finding", error);
  return data.id;
}

/**
 * The Student dismisses an open map Finding. Row Level Security only lets
 * an open Finding change, so one answered since stays as it is.
 */
export async function dismissOpenMapFinding(
  supabase: Supabase,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("map_findings")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("status", "open");
  if (error) failed("Dismissing the map Finding", error);
}

/**
 * The Student accepts an open map Finding: the database applies it to the
 * map. Returns why it was refused, such as a link that would make a cycle,
 * which leaves the Finding open; null when it was applied.
 */
export async function acceptOpenMapFinding(
  supabase: Supabase,
  id: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("accept_map_finding", {
    p_finding_id: id,
  });
  if (error) failed("Accepting the map Finding", error);
  const refusal: string | null = data;
  return refusal;
}

/**
 * The Course's open map Findings by KC, oldest first: each under both of
 * its KCs, naming the other one.
 */
export async function loadMapFindingsByKc(
  supabase: Supabase,
  courseId: string,
  kcName: (id: string) => string,
): Promise<Map<string, MapFindingView[]>> {
  const { data, error } = await supabase
    .from("map_findings")
    .select("kind, kc_id, linked_kc_id, reason")
    .eq("course_id", courseId)
    .eq("status", "open")
    .order("created_at");
  if (error) failed("Loading the map Findings", error);
  const byKc = new Map<string, MapFindingView[]>();
  const add = (kcId: string, view: MapFindingView) =>
    byKc.set(kcId, [...(byKc.get(kcId) ?? []), view]);
  for (const row of data) {
    const kind = row.kind as MapFindingKind;
    const other = (id: string | null) =>
      id === null ? null : { id, name: kcName(id) };
    add(row.kc_id, {
      kind,
      otherKc: other(row.linked_kc_id),
      reason: row.reason,
    });
    if (row.linked_kc_id !== null) {
      add(row.linked_kc_id, {
        kind,
        otherKc: other(row.kc_id),
        reason: row.reason,
      });
    }
  }
  return byKc;
}
