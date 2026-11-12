import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import {
  encodeSnapshot,
  extensionOf,
  SNAPSHOT_TABLES,
  type Snapshot,
} from "../gold-snapshot";
import { GOLD_DIR } from "./gold-seed";

/**
 * Writing a Course from the staging project into `evals/gold/<slug>/`, the
 * same files `pnpm gold export` writes from the local database. Staging is
 * read through GET requests only (ADR 0025), so this makes no writes and no
 * model calls.
 */

const PAGE = 200;
const IN_BATCH = 50;

type Row = Record<string, unknown>;
type Staging = { url: string; secretKey: string };

const headers = (staging: Staging) => ({
  apikey: staging.secretKey,
  Authorization: `Bearer ${staging.secretKey}`,
});

async function get(staging: Staging, fetchFn: typeof fetch, url: string) {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { ...headers(staging), Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Staging returned ${response.status} for ${url.split("?")[0]}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response;
}

/** Every row of `table` whose `column` is one of `values`, page by page. */
async function readAll(
  staging: Staging,
  fetchFn: typeof fetch,
  table: string,
  column: string,
  values: string[],
) {
  const rows: Row[] = [];
  for (let i = 0; i < values.length; i += IN_BATCH) {
    const filter = `${column}=in.(${values.slice(i, i + IN_BATCH).join(",")})`;
    for (let offset = 0; ; offset += PAGE) {
      const url = `${staging.url}/rest/v1/${table}?select=*&${filter}&limit=${PAGE}&offset=${offset}`;
      const page = (await (await get(staging, fetchFn, url)).json()) as Row[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  }
  return rows;
}

/**
 * Writes the staging Course `courseId` into `evals/gold/<slug>/`: every
 * `SNAPSHOT_TABLES` row and the Materials' files. Returns the row count per
 * table.
 */
export async function pullCourse(
  staging: Staging,
  courseId: string,
  slug: string,
  options: { name?: string; fetchFn?: typeof fetch; dir?: string } = {},
) {
  const fetchFn = options.fetchFn ?? fetch;
  const [course] = await readAll(staging, fetchFn, "courses", "id", [courseId]);
  if (!course) throw new Error(`Course ${courseId} not found on staging`);

  const tables: Snapshot["tables"] = {};
  for (const { table, parent } of SNAPSHOT_TABLES) {
    tables[table] = parent
      ? await readAll(
          staging,
          fetchFn,
          table,
          parent.column,
          (tables[parent.table] ?? []).map((row) => row.id as string),
        )
      : await readAll(staging, fetchFn, table, "course_id", [courseId]);
  }
  const snapshot: Snapshot = {
    version: 1,
    courseName: options.name ?? (course.name as string),
    courseId,
    pairingRequested: course.pairing_requested as number,
    tables,
  };

  const dir = path.join(options.dir ?? GOLD_DIR, slug);
  await mkdir(path.join(dir, "materials"), { recursive: true });
  for (const material of tables.materials ?? []) {
    const url = `${staging.url}/storage/v1/object/${MATERIALS_BUCKET}/${material.storage_path as string}`;
    const bytes = Buffer.from(
      await (await get(staging, fetchFn, url)).arrayBuffer(),
    );
    const file = `${material.id as string}.${extensionOf(material.media_type as string)}`;
    await writeFile(path.join(dir, "materials", file), bytes);
  }
  await writeFile(path.join(dir, "snapshot.json.gz"), encodeSnapshot(snapshot));

  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length]),
  );
}
