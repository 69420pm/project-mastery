import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";

/**
 * A gold Course's built content: what the pipeline stores for a Course
 * (Materials, chunks, Knowledge map, Topics, Reading sections, priorities and
 * the Brief), without anything a Student did. `pnpm gold export` writes it
 * and `pnpm gold seed` loads it into a Student, so the tutor can be tried or
 * evaluated without running the pipeline again.
 */

type Parent = { table: string; column: string };

/**
 * The tables a snapshot holds, in the order they are inserted (parents first).
 * A table with `course_id` is read by it; one without it is read by `parent`.
 * Tables that a Student's activity fills (Chats, attempts, Memory, Problems,
 * mock exams and so on) are left out on purpose.
 */
export const SNAPSHOT_TABLES: { table: string; parent?: Parent }[] = [
  { table: "materials" },
  {
    table: "material_pages",
    parent: { table: "materials", column: "material_id" },
  },
  { table: "chunks" },
  { table: "knowledge_map_builds" },
  { table: "knowledge_map_chunks" },
  { table: "big_ideas" },
  { table: "kcs" },
  { table: "kc_sources" },
  { table: "prerequisite_links" },
  { table: "exercises" },
  { table: "exercise_kcs" },
  { table: "exercise_solutions" },
  { table: "findings" },
  { table: "finding_sources" },
  { table: "topics" },
  { table: "topic_kcs", parent: { table: "topics", column: "topic_id" } },
  { table: "reading_sections" },
  { table: "kc_priorities" },
  { table: "priority_runs" },
  { table: "briefs" },
  { table: "brief_excluded_materials" },
];

const rowSchema = z.record(z.string(), z.unknown());

export const snapshotSchema = z.object({
  version: z.literal(1),
  /** The Course's name; a seed replaces a Course of the same name. */
  courseName: z.string(),
  courseId: z.string(),
  pairingRequested: z.number(),
  tables: z.record(z.string(), z.array(rowSchema)),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
type Row = z.infer<typeof rowSchema>;

export function encodeSnapshot(snapshot: Snapshot) {
  return gzipSync(JSON.stringify(snapshot));
}

export function decodeSnapshot(bytes: Uint8Array) {
  return snapshotSchema.parse(JSON.parse(gunzipSync(bytes).toString("utf8")));
}

/** The file extension of an uploaded Material's media type. */
export function extensionOf(mediaType: string) {
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  return extensions[mediaType] ?? "bin";
}

/** `value` with every string in `ids` replaced, at any depth (jsonb included). */
function replaceIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceIds(v, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceIds(v, ids)]),
    );
  }
  return value;
}

/**
 * The snapshot's rows for a new Student and Course. Every row id gets a new
 * id, and each place that holds an old id (foreign keys, `chunk_ids` arrays,
 * ids inside jsonb) is rewritten to match; `owner`, `course_id` and each
 * Material's `storage_path` point at the new Student and Course. Returns the
 * new ids of the Materials by old id, which name the files to upload.
 */
export function remapSnapshot(
  snapshot: Snapshot,
  studentId: string,
  courseId: string,
) {
  const ids = new Map<string, string>([[snapshot.courseId, courseId]]);
  for (const rows of Object.values(snapshot.tables)) {
    for (const row of rows) {
      if (typeof row.id === "string") ids.set(row.id, randomUUID());
    }
  }

  const tables: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    tables[table] = rows.map((row) => {
      const next = replaceIds(row, ids) as Row;
      next.owner = studentId;
      if ("course_id" in next) next.course_id = courseId;
      if (table === "materials") {
        next.storage_path = `${studentId}/${courseId}/${next.id}`;
      }
      return next;
    });
  }

  const materialIds = Object.fromEntries(
    (snapshot.tables.materials ?? []).map((row) => [
      row.id as string,
      ids.get(row.id as string) as string,
    ]),
  );
  return { tables, materialIds };
}

/** The exam date a seeded Brief gets: `days` after `today`, as `YYYY-MM-DD`. */
export function examDateIn(days: number, today = new Date()) {
  const date = new Date(today.getTime() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}
