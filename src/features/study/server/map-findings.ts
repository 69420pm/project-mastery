import "server-only";
import { z } from "zod";
import type { MapFindingKind, MapFindingView } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Map Findings the tutor files with `flagMap`, written and read as the
 * Student. The Knowledge map build applies the accepted ones; nothing here
 * changes the map.
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
 * The Student's answer to an open map Finding: accepted, for the next
 * Update map to apply, or dismissed. Row Level Security only lets an open
 * Finding change, so one answered since stays as it is.
 */
export async function answerOpenMapFinding(
  supabase: Supabase,
  id: string,
  status: "accepted" | "dismissed",
): Promise<void> {
  const { error } = await supabase
    .from("map_findings")
    .update({ status })
    .eq("id", id)
    .eq("status", "open");
  if (error) failed("Answering the map Finding", error);
}

/**
 * The Course's open and accepted map Findings by KC, oldest first: each
 * under both of its KCs, naming the other one.
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
    .in("status", ["open", "accepted"])
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
