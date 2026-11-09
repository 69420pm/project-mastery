import { z } from "zod";
import { optional, parseEnv } from "@/lib/env";
import { createAdminClientFor } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { ACTIVITY_TABLES, SNAPSHOT_TABLES } from "../gold-snapshot";
import { downloadMaterial, readCourse, rowCounts } from "./gold-export";
import { removeCourses, seedSnapshot } from "./gold-seed";

/**
 * `pnpm gold demo <staging-course-id>`: copies a staging Course, with its
 * Chats and everything the Student did, into the demo account that the
 * `/demo` link signs into. The target project is given explicitly, so the
 * copy never lands in the app's own database by accident:
 *
 *   DEMO_SUPABASE_URL=https://<ref>.supabase.co \
 *   DEMO_SUPABASE_SECRET_KEY=sb_secret_... \
 *   DEMO_EMAIL=demo@... DEMO_PASSWORD=... \
 *   pnpm gold demo <staging-course-id>
 *
 * It reads staging with `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SECRET_KEY` and writes nothing there. On the target it
 * creates the demo account (or sets its password to `DEMO_PASSWORD`),
 * deletes all of its Courses and stores the copy, so a run also resets the
 * demo. Makes no model calls.
 */

const schema = z.object({
  STAGING_SUPABASE_URL: z.url(),
  STAGING_SUPABASE_SECRET_KEY: z.string().min(1),
  DEMO_SUPABASE_URL: z.url(),
  DEMO_SUPABASE_SECRET_KEY: z.string().min(1),
  DEMO_EMAIL: z.email(),
  DEMO_PASSWORD: z.string().min(8),
  DEMO_COURSE_NAME: optional(z.string().min(1)),
});

/** The demo account on the target, created or given `password`. */
async function demoStudent(
  supabase: AdminSupabase,
  email: string,
  password: string,
) {
  const { data: users, error } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) throw new Error(error.message);
  const existing = users.users.find((user) => user.email === email);
  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existing.id,
      { password },
    );
    if (updateError) throw new Error(updateError.message);
    return existing.id;
  }
  const { data, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(createError.message);
  return data.user.id;
}

export async function copyDemoCourse(courseId: string, examInDays: number) {
  const env = parseEnv(schema, process.env);
  if (env.DEMO_SUPABASE_URL === env.STAGING_SUPABASE_URL) {
    throw new Error(
      "DEMO_SUPABASE_URL is the staging project; pick the target.",
    );
  }
  const source = createAdminClientFor(
    env.STAGING_SUPABASE_URL,
    env.STAGING_SUPABASE_SECRET_KEY,
  );
  const target = createAdminClientFor(
    env.DEMO_SUPABASE_URL,
    env.DEMO_SUPABASE_SECRET_KEY,
  );
  const tables = [...SNAPSHOT_TABLES, ...ACTIVITY_TABLES];

  const snapshot = await readCourse(source, courseId, {
    tables,
    name: env.DEMO_COURSE_NAME,
  });
  const materials = new Map(
    (snapshot.tables.materials ?? []).map((row) => [row.id as string, row]),
  );
  const studentId = await demoStudent(
    target,
    env.DEMO_EMAIL,
    env.DEMO_PASSWORD,
  );
  await removeCourses(target, studentId);
  const newId = await seedSnapshot(target, snapshot, studentId, {
    examInDays,
    tables,
    materialFile: (id) => downloadMaterial(source, materials.get(id)!),
  });
  console.info(
    `Copied "${snapshot.courseName}" to ${env.DEMO_EMAIL} on ${env.DEMO_SUPABASE_URL}, exam in ${examInDays} days: /courses/${newId}/map\n${rowCounts(snapshot)}`,
  );
}
