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
} from "../gold-snapshot";

/**
 * Loading a gold course's snapshot into a Student (`evals/gold/README.md`):
 * the code behind `pnpm gold seed`, which the smoke checks share.
 */

export const GOLD_DIR = "evals/gold";

const INSERT_BATCH = 100;

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

/**
 * Stores `snapshot` as a new Course of `studentId`, uploads its Materials'
 * files from `evals/gold/<slug>/materials/` and sets the Brief's exam date
 * `examInDays` from today. Returns the new Course's id.
 */
export async function seedSnapshot(
  supabase: AdminSupabase,
  slug: string,
  snapshot: Snapshot,
  studentId: string,
  examInDays: number,
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
  for (const { table: name } of SNAPSHOT_TABLES) {
    const rows = tables[name] ?? [];
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error: insertError } = await table(supabase, name).insert(
        rows.slice(i, i + INSERT_BATCH) as never,
      );
      if (insertError) throw new Error(`${name}: ${insertError.message}`);
    }
  }

  const dir = path.join(GOLD_DIR, slug, "materials");
  const files = await readdir(dir);
  for (const material of tables.materials ?? []) {
    const oldId = Object.keys(materialIds).find(
      (id) => materialIds[id] === material.id,
    ) as string;
    const file = files.find((f) => f.startsWith(`${oldId}.`));
    if (!file) throw new Error(`No file for Material ${oldId} in ${dir}`);
    const { error: uploadError } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .upload(
        material.storage_path as string,
        await readFile(path.join(dir, file)),
        { contentType: material.media_type as string },
      );
    if (uploadError) throw new Error(uploadError.message);
  }
  return course.id;
}
