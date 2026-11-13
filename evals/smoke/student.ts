import { randomUUID } from "node:crypto";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * Throwaway Students on the local stack, for the smoke checks and the
 * tutoring scenarios.
 */

/** A Student no one signs in as, owning everything a run stores. */
export async function createStudent(supabase: AdminSupabase, prefix: string) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${prefix}-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error) throw new Error(`Creating the Student failed: ${error.message}`);
  return data.user.id;
}

/** Deletes the Student's files, then the Student, whose rows cascade. */
export async function deleteStudent(
  supabase: AdminSupabase,
  studentId: string,
) {
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  const { data: courses } = await bucket.list(studentId);
  for (const course of courses ?? []) {
    const { data: files } = await bucket.list(`${studentId}/${course.name}`);
    const paths = (files ?? []).map(
      (f) => `${studentId}/${course.name}/${f.name}`,
    );
    if (paths.length > 0) await bucket.remove(paths);
  }
  const { error } = await supabase.auth.admin.deleteUser(studentId);
  if (error) console.error(`Deleting the Student failed: ${error.message}`);
}
