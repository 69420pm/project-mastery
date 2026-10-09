"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { materialStoragePath } from "@/features/courses/domain/material-storage";
import {
  courseIdSchema,
  courseNotFoundMessage,
  createCourseSchema,
  materialIdSchema,
  registerMaterialSchema,
  renameCourseSchema,
  renameMaterialSchema,
  uploadIdsSchema,
} from "@/features/courses/schemas";
import {
  findCourse,
  insertCourse,
  removeCourse,
  updateCourseName,
} from "@/features/courses/server/course-store";
import {
  countChatsAttaching,
  findMaterial,
  findStoredFile,
  insertMaterial,
  removeCourseFiles,
  removeMaterial,
  removeStoredFiles,
  signFileUrl,
  updateMaterialName,
} from "@/features/courses/server/material-store";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

const signedOut = { ok: false, message: "Sign in again to continue." } as const;
const courseNotFound = { ok: false, message: courseNotFoundMessage } as const;
const uploadIncomplete = {
  ok: false,
  message: "The upload did not finish. Please try again.",
} as const;

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

/**
 * Registers a file the browser uploaded to Storage as a Material of the
 * Course. The upload went to `<owner>/<course>/<material id>` first, because
 * Server Action bodies are too small for the file. When registering fails,
 * the uploaded file is removed again, so no file stays behind without a
 * Material. The page refreshes to show it, unless `refresh` is false: a new
 * Chat's page would then be replaced, with the message being written.
 */
export async function registerMaterial(input: {
  /** Whether to refresh the page, true unless false. */
  refresh?: boolean;
  materialId: string;
  courseId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getUser();
  if (!user) return signedOut;
  const supabase = await createClient();

  const parsed = parseActionInput(registerMaterialSchema, input);
  // The ids alone locate the upload, so it is removed even when the name,
  // type or size is refused.
  const upload = parseActionInput(uploadIdsSchema, input);
  const path =
    upload.ok &&
    materialStoragePath(user.id, upload.data.courseId, upload.data.materialId);
  const removeUpload = async () => {
    if (path) await removeStoredFiles(supabase, [path]);
  };

  if (!parsed.ok) {
    await removeUpload();
    return parsed;
  }
  const material = parsed.data;
  if (!path) throw new Error("A valid Material has a storage path.");

  if (!(await findCourse(supabase, material.courseId))) {
    await removeUpload();
    return courseNotFound;
  }

  const stored = await findStoredFile(supabase, path);
  if (
    !stored ||
    stored.size !== material.sizeBytes ||
    stored.contentType !== material.mediaType
  ) {
    await removeUpload();
    return uploadIncomplete;
  }

  const inserted = await insertMaterial(supabase, {
    id: material.materialId,
    courseId: material.courseId,
    name: material.name,
    mediaType: material.mediaType,
    sizeBytes: material.sizeBytes,
    storagePath: path,
  });
  // A second registration of the same upload keeps the first one's file.
  if (inserted === "duplicate")
    return { ok: true, data: { id: material.materialId } };
  if (inserted === "denied") {
    await removeUpload();
    return courseNotFound;
  }

  if (input.refresh !== false) revalidatePath("/", "layout");
  return { ok: true, data: { id: material.materialId } };
}

const materialNotFound = {
  ok: false,
  message: "This material does not exist.",
} as const;

/** Renames one of the Student's Materials. Duplicate names are fine. */
export async function renameMaterial(input: {
  materialId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(renameMaterialSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const renamed = await updateMaterialName(
    await createClient(),
    parsed.data.materialId,
    parsed.data.name,
  );
  if (!renamed) return materialNotFound;

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * Deletes one of the Student's Materials for good: its file first, then the
 * Material, so a file never stays behind without one.
 */
export async function deleteMaterial(input: {
  materialId: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(materialIdSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;
  const supabase = await createClient();

  const material = await findMaterial(supabase, parsed.data.materialId);
  if (!material) return materialNotFound;
  if (!(await removeStoredFiles(supabase, [material.storagePath]))) {
    return {
      ok: false,
      message: "The material could not be deleted. Please try again.",
    };
  }
  await removeMaterial(supabase, parsed.data.materialId);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * How many of the Student's Chats attach the Material, for the delete
 * confirmation.
 */
export async function countMaterialChats(input: {
  materialId: string;
}): Promise<ActionResult<{ chatCount: number }>> {
  const parsed = parseActionInput(materialIdSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;

  const chatCount = await countChatsAttaching(
    await createClient(),
    parsed.data.materialId,
  );
  return { ok: true, data: { chatCount } };
}

/** How long a link to open a Material works, in seconds. */
const MATERIAL_LINK_SECONDS = 5 * 60;

/**
 * A short-lived link to one of the Student's Materials, to show it in the
 * viewer, with its name and type.
 */
export async function openMaterial(input: {
  materialId: string;
}): Promise<ActionResult<{ name: string; mediaType: string; url: string }>> {
  const parsed = parseActionInput(materialIdSchema, input);
  if (!parsed.ok) return parsed;
  if (!(await getUser())) return signedOut;
  const supabase = await createClient();

  const material = await findMaterial(supabase, parsed.data.materialId);
  if (!material) return materialNotFound;
  const url = await signFileUrl(
    supabase,
    material.storagePath,
    MATERIAL_LINK_SECONDS,
  );
  if (!url) {
    return {
      ok: false,
      message: "The material could not be opened. Please try again.",
    };
  }
  return {
    ok: true,
    data: { name: material.name, mediaType: material.mediaType, url },
  };
}

/**
 * Deletes one of the Student's Courses for good, with its Chats and
 * Materials. The files go first: when Storage fails, the Course stays, so it
 * never disappears while its files stay behind.
 */
export async function deleteCourse(input: {
  courseId: string;
}): Promise<ActionResult> {
  const parsed = parseActionInput(courseIdSchema, input);
  if (!parsed.ok) return parsed;
  const user = await getUser();
  if (!user) return signedOut;
  const supabase = await createClient();
  const { courseId } = parsed.data;

  if (!(await findCourse(supabase, courseId))) return courseNotFound;
  if (!(await removeCourseFiles(supabase, user.id, courseId))) {
    return {
      ok: false,
      message:
        "The course's materials could not be deleted, so the course was kept. Please try again.",
    };
  }
  const deleted = await removeCourse(supabase, courseId);
  if (!deleted) return courseNotFound;

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
