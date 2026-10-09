import "server-only";
import { cache } from "react";
import { z } from "zod";
import {
  findCourse,
  listCourses,
} from "@/features/courses/server/course-store";
import {
  downloadStoredFile,
  findMaterials,
  listMaterials,
} from "@/features/courses/server/material-store";
import type {
  CourseListItem,
  CourseWithCounts,
  MaterialListItem,
  StoredMaterial,
} from "@/features/courses/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Courses, most recently updated first. Empty when
 * signed out, without redirecting: each page guards itself with
 * `requireUser`.
 */
export async function getCourseList(): Promise<CourseWithCounts[]> {
  if (!(await getUser())) return [];
  return listCourses(await createClient());
}

/**
 * The signed-in Student's Materials in a Course, newest first. Empty when
 * signed out or for another Student's Course.
 */
export async function getMaterialList(
  courseId: string,
): Promise<MaterialListItem[]> {
  if (!(await getUser())) return [];
  return listMaterials(await createClient(), courseId);
}

/**
 * The signed-in Student's Materials among `materialIds`, with where their
 * files are. Missing Materials and other Students' are left out.
 */
export async function getMaterials(
  materialIds: string[],
): Promise<StoredMaterial[]> {
  return findMaterials(await createClient(), materialIds);
}

/**
 * The bytes of the signed-in Student's Material file: "missing" when the
 * file is gone, "failed" when Storage failed.
 */
export async function readMaterialFile(
  material: StoredMaterial,
): Promise<Uint8Array | "missing" | "failed"> {
  return downloadStoredFile(await createClient(), material.storagePath);
}

/**
 * The signed-in Student's Course, or null when the id is malformed, unknown
 * or another Student's Course (show not-found), or when signed out. It does
 * not redirect: pages guard themselves with `requireUser`. Cached per
 * request, so a layout and its page share one read.
 */
export const getCourse = cache(
  async (courseId: string): Promise<CourseListItem | null> => {
    if (!z.uuid().safeParse(courseId).success) return null;
    if (!(await getUser())) return null;
    return findCourse(await createClient(), courseId);
  },
);
