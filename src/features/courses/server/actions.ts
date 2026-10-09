"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import {
  courseIdSchema,
  courseNotFoundMessage,
  createCourseSchema,
  renameCourseSchema,
} from "@/features/courses/schemas";
import {
  insertCourse,
  removeCourse,
  updateCourseName,
} from "@/features/courses/server/course-store";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

const signedOut = { ok: false, message: "Sign in again to continue." } as const;
const courseNotFound = { ok: false, message: courseNotFoundMessage } as const;

/** Creates a Course with the given name. Names need not be unique. */
export async function createCourse(input: {
  name: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = parseActionInput(createCourseSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const id = await insertCourse(await createClient(), parsed.data.name);
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

/** Renames one of the Student's Courses. Duplicate names are fine. */
export async function renameCourse(input: {
  courseId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(renameCourseSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const renamed = await updateCourseName(
    await createClient(),
    parsed.data.courseId,
    parsed.data.name,
  );
  if (!renamed) return courseNotFound;

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Deletes one of the Student's Courses for good. */
export async function deleteCourse(input: {
  courseId: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(courseIdSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const deleted = await removeCourse(
    await createClient(),
    parsed.data.courseId,
  );
  if (!deleted) return courseNotFound;

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
