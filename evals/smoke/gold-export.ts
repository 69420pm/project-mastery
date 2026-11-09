import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import {
  encodeSnapshot,
  extensionOf,
  SNAPSHOT_TABLES,
  type Snapshot,
  type SnapshotTable,
} from "../gold-snapshot";
import { GOLD_DIR, table } from "./gold-seed";

/**
 * Writing a Course from the local database into `evals/gold/<slug>/`:
 * `snapshot.json.gz` and the Materials' files in `materials/`. Used by
 * `pnpm gold export` and `pnpm smoke map export`.
 */

const PAGE = 1000;

type Row = Record<string, unknown>;

async function readAll(
  supabase: AdminSupabase,
  name: string,
  column: string,
  values: string[],
) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await table(supabase, name)
      .select("*")
      .in(column as "id", values)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    rows.push(...(data as Row[]));
    if (data.length < PAGE) return rows;
  }
}

/**
 * The Course's rows in `tables` (parents first), as a snapshot named `name`
 * if given.
 */
export async function readCourse(
  supabase: AdminSupabase,
  courseId: string,
  {
    tables: list = SNAPSHOT_TABLES,
    name,
  }: { tables?: SnapshotTable[]; name?: string } = {},
): Promise<Snapshot> {
  const { data: course, error } = await supabase
    .from("courses")
    .select("id, name, pairing_requested")
    .eq("id", courseId)
    .single();
  if (error) throw new Error(`Course ${courseId}: ${error.message}`);

  const tables: Snapshot["tables"] = {};
  for (const { table: name, parent } of list) {
    tables[name] = parent
      ? await readAll(
          supabase,
          name,
          parent.column,
          (tables[parent.table] ?? []).map((row) => row.id as string),
        )
      : await readAll(supabase, name, "course_id", [courseId]);
  }
  return {
    version: 1,
    courseName: name ?? course.name,
    courseId,
    pairingRequested: course.pairing_requested,
    tables,
  };
}

/** The stored file of a snapshot's Material row. */
export async function downloadMaterial(supabase: AdminSupabase, material: Row) {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .download(material.storage_path as string);
  if (error) throw new Error(error.message);
  return new Uint8Array(await data.arrayBuffer());
}

/** The number of rows per table, for a log line. */
export function rowCounts(snapshot: Snapshot) {
  return Object.entries(snapshot.tables)
    .filter(([, rows]) => rows.length > 0)
    .map(([n, rows]) => `${n} ${rows.length}`)
    .join(", ");
}

/** Writes the Course into `evals/gold/<slug>/`, named `name` if given. */
export async function exportCourse(
  supabase: AdminSupabase,
  courseId: string,
  slug: string,
  name?: string,
) {
  const snapshot = await readCourse(supabase, courseId, { name });
  const dir = path.join(GOLD_DIR, slug);
  await mkdir(path.join(dir, "materials"), { recursive: true });
  for (const material of snapshot.tables.materials ?? []) {
    const file = `${material.id as string}.${extensionOf(material.media_type as string)}`;
    await writeFile(
      path.join(dir, "materials", file),
      await downloadMaterial(supabase, material),
    );
  }
  await writeFile(path.join(dir, "snapshot.json.gz"), encodeSnapshot(snapshot));
  console.info(
    `Exported "${snapshot.courseName}" to ${dir}: ${rowCounts(snapshot)}`,
  );
}
