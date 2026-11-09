/**
 * Gold courses: a Course built once by the real pipeline, kept in the repo as
 * a snapshot, and loaded into a local Student on demand, so the tutor can be
 * tried and evaluated without paying for the pipeline again.
 *
 *   pnpm gold list
 *   pnpm gold export <course-id> <slug> [--name "Course name"]
 *   pnpm gold seed <slug> [--exam-in-days 42]
 *
 * `export` reads a Course from the local database (build it by uploading its
 * Materials in the app with a real model) into `evals/gold/<slug>/`:
 * `snapshot.json.gz` and the Materials' files in `materials/`. `seed` creates
 * or reuses the gold Student and replaces its Course of that name. Local
 * database only; makes no model calls.
 */
import { parseArgs } from "node:util";
import { readdir } from "node:fs/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import { exportCourse } from "./gold-export";
import { GOLD_DIR, readSnapshot, seedSnapshot } from "./gold-seed";

const GOLD_EMAIL = process.env.GOLD_EMAIL ?? "gold@example.com";
const GOLD_PASSWORD = process.env.GOLD_PASSWORD ?? "gold-password";
const DEFAULT_EXAM_IN_DAYS = 42;

/** The gold Student, created on first use with a known local password. */
async function goldStudent(supabase: AdminSupabase) {
  const { data: users, error } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) throw new Error(error.message);
  const existing = users.users.find((user) => user.email === GOLD_EMAIL);
  if (existing) return existing.id;
  const { data, error: createError } = await supabase.auth.admin.createUser({
    email: GOLD_EMAIL,
    password: GOLD_PASSWORD,
    email_confirm: true,
  });
  if (createError) throw new Error(createError.message);
  return data.user.id;
}

/** Deletes the Student's Course of this name with its files. */
async function removeCourse(
  supabase: AdminSupabase,
  studentId: string,
  courseName: string,
) {
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id")
    .eq("owner", studentId)
    .eq("name", courseName);
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

async function seedCourse(slug: string, examInDays: number) {
  const snapshot = await readSnapshot(slug);
  const supabase = createAdminClient();
  const studentId = await goldStudent(supabase);
  await removeCourse(supabase, studentId, snapshot.courseName);
  const courseId = await seedSnapshot(
    supabase,
    slug,
    snapshot,
    studentId,
    examInDays,
  );
  console.info(
    `Seeded "${snapshot.courseName}" for ${GOLD_EMAIL} (password ${GOLD_PASSWORD}), exam in ${examInDays} days: /courses/${courseId}/map`,
  );
}

async function list() {
  const entries = await readdir(GOLD_DIR, { withFileTypes: true });
  for (const entry of entries.filter((e) => e.isDirectory())) {
    try {
      const snapshot = await readSnapshot(entry.name);
      console.info(`${entry.name}: "${snapshot.courseName}"`);
    } catch {
      // A folder without a snapshot yet, before its gold run.
    }
  }
}

function assertLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(`pnpm gold works on the local database only, not ${url}`);
  }
}

async function main() {
  assertLocal();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      "exam-in-days": { type: "string" },
    },
  });
  const [command, first, second] = positionals;
  if (command === "list") return list();
  if (command === "export" && first && second) {
    return exportCourse(createAdminClient(), first, second, values.name);
  }
  if (command === "seed" && first) {
    return seedCourse(
      first,
      Number(values["exam-in-days"] ?? DEFAULT_EXAM_IN_DAYS),
    );
  }
  throw new Error(
    "Usage: pnpm gold list | export <course-id> <slug> [--name N] | seed <slug> [--exam-in-days N]",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
