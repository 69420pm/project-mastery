import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import {
  decodeSnapshot,
  examDateIn,
  remapSnapshot,
  SNAPSHOT_TABLES,
  type Snapshot,
  type SnapshotTable,
} from "../gold-snapshot";

/**
 * Loading a gold course's snapshot into a Student (`evals/gold/README.md`):
 * the code behind `pnpm gold seed` and `pnpm gold demo`, which the smoke
 * checks share.
 */

export const GOLD_DIR = "evals/gold";

const INSERT_BATCH = 100;

type Row = Record<string, unknown>;

// Table names here come from SNAPSHOT_TABLES, not from the generated types.
export function table(supabase: AdminSupabase, name: string) {
  return supabase.from(name as "kcs");
}

/** The snapshot of the gold course `slug`. */
export async function readSnapshot(slug: string): Promise<Snapshot> {
  return decodeSnapshot(
    await readFile(path.join(GOLD_DIR, slug, "snapshot.json.gz")),
  );
}

/** A Material's file by its id in the snapshot. */
export type MaterialFile = (snapshotMaterialId: string) => Promise<Uint8Array>;

/** The files of the gold course `slug`, from `evals/gold/<slug>/materials/`. */
export function goldMaterialFiles(slug: string): MaterialFile {
  const dir = path.join(GOLD_DIR, slug, "materials");
  return async (id) => {
    const file = (await readdir(dir)).find((f) => f.startsWith(`${id}.`));
    if (!file) throw new Error(`No file for Material ${id} in ${dir}`);
    return readFile(path.join(dir, file));
  };
}

/** Deletes every Course of the Student named `courseName`, or all of them. */
export async function removeCourses(
  supabase: AdminSupabase,
  studentId: string,
  courseName?: string,
) {
  let query = supabase.from("courses").select("id").eq("owner", studentId);
  if (courseName !== undefined) query = query.eq("name", courseName);
  const { data: courses, error } = await query;
  if (error) throw new Error(error.message);
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  for (const { id } of courses) {
    const { data: files } = await bucket.list(`${studentId}/${id}`);
    const paths = (files ?? []).map((f) => `${studentId}/${id}/${f.name}`);
    if (paths.length > 0) await bucket.remove(paths);
    const { error: deleteError } = await supabase
      .from("courses")
      .delete()
      .eq("id", id);
    if (deleteError) throw new Error(deleteError.message);
  }
}

async function insertAll(supabase: AdminSupabase, name: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await table(supabase, name).insert(
      rows.slice(i, i + INSERT_BATCH) as never,
    );
    if (error) throw new Error(`${name}: ${error.message}`);
  }
}

/**
 * Stores `snapshot` as a new Course of `studentId`, uploads its Materials'
 * files from `materialFile` and sets the Brief's exam date `examInDays` from
 * today. Inserts the rows of `tables`. Returns the new Course's id.
 */
export async function seedSnapshot(
  supabase: AdminSupabase,
  snapshot: Snapshot,
  studentId: string,
  {
    examInDays,
    materialFile,
    tables: list = SNAPSHOT_TABLES,
  }: {
    examInDays: number;
    materialFile: MaterialFile;
    tables?: SnapshotTable[];
  },
): Promise<string> {
  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      owner: studentId,
      name: snapshot.courseName,
      pairing_requested: snapshot.pairingRequested,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Creating a Course may add its Brief; the snapshot's replaces it.
  await supabase.from("briefs").delete().eq("course_id", course.id);

  const { tables, materialIds } = remapSnapshot(snapshot, studentId, course.id);
  for (const row of tables.briefs ?? []) {
    row.exam_date = examDateIn(examInDays);
  }
  const later: Array<{ name: string; row: Row }> = [];
  for (const { table: name, deferred = [] } of list) {
    const rows = (tables[name] ?? []).map((row) => {
      const values = deferred.filter((column) => row[column] != null);
      if (values.length > 0) later.push({ name, row });
      return { ...row, ...Object.fromEntries(deferred.map((c) => [c, null])) };
    });
    // Each new Chat starts its own Study session; the snapshot's replace them.
    if (name === "study_sessions") {
      const { error: deleteError } = await supabase
        .from("study_sessions")
        .delete()
        .eq("course_id", course.id);
      if (deleteError) throw new Error(deleteError.message);
    }
    await insertAll(supabase, name, rows);
  }
  for (const { name, row } of later) {
    const deferred = list.find((t) => t.table === name)?.deferred ?? [];
    const { error: updateError } = await table(supabase, name)
      .update(Object.fromEntries(deferred.map((c) => [c, row[c]])) as never)
      .eq("id", row.id as string);
    if (updateError) throw new Error(`${name}: ${updateError.message}`);
  }

  for (const material of tables.materials ?? []) {
    const oldId = Object.keys(materialIds).find(
      (id) => materialIds[id] === material.id,
    ) as string;
    const { error: uploadError } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .upload(material.storage_path as string, await materialFile(oldId), {
        contentType: material.media_type as string,
      });
    if (uploadError) throw new Error(uploadError.message);
  }
  return course.id;
}
