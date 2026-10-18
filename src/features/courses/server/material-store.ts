import "server-only";
import {
  courseFolder,
  MATERIALS_BUCKET,
} from "@/features/courses/domain/material-storage";
import type {
  MaterialListItem,
  StoredMaterial,
} from "@/features/courses/types";
import type { ParseStatus } from "@/features/ingestion";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Reads and writes Materials and their files as the signed-in Student, so
 * Row Level Security and the bucket policies apply: another Student's
 * Material reads as missing.
 */

/** A Material's stored file, or null when it is missing or not theirs. */
export async function findStoredFile(
  supabase: Supabase,
  path: string,
): Promise<{ size: number; contentType: string | undefined } | null> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .info(path);
  if (error) {
    if (error.message !== "Object not found") {
      console.error("Reading a Material's file failed", error);
    }
    return null;
  }
  return { size: data.size ?? 0, contentType: data.contentType ?? undefined };
}

/**
 * Removes Material files. True when they are gone, false when Storage
 * failed; missing files count as gone.
 */
export async function removeStoredFiles(
  supabase: Supabase,
  paths: string[],
): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await supabase.storage.from(MATERIALS_BUCKET).remove(paths);
  if (error) {
    console.error("Removing Material files failed", error);
    return false;
  }
  return true;
}

/** How many files `list` returns per page. */
const LIST_PAGE_SIZE = 1000;

/**
 * Removes every file in a folder and its sub-folders. True when they are
 * gone, false when Storage failed.
 */
async function removeFolder(
  supabase: Supabase,
  folder: string,
): Promise<boolean> {
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  for (;;) {
    // Each round lists from the start, since the last round removed its page.
    const { data, error } = await bucket.list(folder, {
      limit: LIST_PAGE_SIZE,
    });
    if (error) {
      console.error("Listing Material files failed", error);
      return false;
    }
    if (data.length === 0) return true;
    // A sub-folder is listed without an id, a file with one.
    for (const entry of data.filter((entry) => entry.id === null)) {
      if (!(await removeFolder(supabase, `${folder}/${entry.name}`))) {
        return false;
      }
    }
    const removed = await removeStoredFiles(
      supabase,
      data
        .filter((entry) => entry.id !== null)
        .map((file) => `${folder}/${file.name}`),
    );
    if (!removed) return false;
    if (data.length < LIST_PAGE_SIZE) return true;
  }
}

/**
 * Removes a Material's file and everything stored under its path: the page
 * images and figure crops of its parse. True when they are gone, false when
 * Storage failed.
 */
export async function removeMaterialFiles(
  supabase: Supabase,
  storagePath: string,
): Promise<boolean> {
  return (
    (await removeFolder(supabase, storagePath)) &&
    (await removeStoredFiles(supabase, [storagePath]))
  );
}

/**
 * Removes every file in a Course's folder, including files whose upload was
 * never registered as a Material and the page images and figure crops of
 * its Materials. True when they are gone, false when Storage failed.
 */
export async function removeCourseFiles(
  supabase: Supabase,
  owner: string,
  courseId: string,
): Promise<boolean> {
  return removeFolder(supabase, courseFolder(owner, courseId));
}

export type NewMaterial = {
  id: string;
  courseId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  storagePath: string;
};

/**
 * Stores a Material owned by the signed-in Student. Returns "duplicate" when
 * a Material with this id already exists, and "denied" when the Course is not
 * theirs.
 */
export async function insertMaterial(
  supabase: Supabase,
  material: NewMaterial,
): Promise<"ok" | "duplicate" | "denied"> {
  const { error } = await supabase.from("materials").insert({
    id: material.id,
    course_id: material.courseId,
    name: material.name,
    media_type: material.mediaType,
    size_bytes: material.sizeBytes,
    storage_path: material.storagePath,
  });
  if (!error) return "ok";
  if (error.code === "23505") return "duplicate";
  if (error.code === "42501") return "denied";
  failed("Registering the Material", error);
}

/** The Student's Material with this id, or null when it is missing or not theirs. */
export async function findMaterial(
  supabase: Supabase,
  materialId: string,
): Promise<{
  courseId: string;
  name: string;
  mediaType: string;
  storagePath: string;
} | null> {
  const { data, error } = await supabase
    .from("materials")
    .select("course_id, name, media_type, storage_path")
    .eq("id", materialId)
    .maybeSingle();
  if (error) failed("Loading the Material", error);
  return (
    data && {
      courseId: data.course_id,
      name: data.name,
      mediaType: data.media_type,
      storagePath: data.storage_path,
    }
  );
}

/**
 * The Student's Materials among `materialIds`. Ids of missing Materials, or
 * of another Student's, are left out.
 */
export async function findMaterials(
  supabase: Supabase,
  materialIds: string[],
): Promise<StoredMaterial[]> {
  if (materialIds.length === 0) return [];
  const { data, error } = await supabase
    .from("materials")
    .select("id, course_id, name, media_type, size_bytes, storage_path")
    .in("id", materialIds);
  if (error) failed("Loading the Materials", error);
  return data.map((row) => ({
    id: row.id,
    courseId: row.course_id,
    name: row.name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
  }));
}

/**
 * The bytes of one of the Student's Material files: "missing" when it is
 * gone or not theirs, "failed" when Storage failed.
 */
export async function downloadStoredFile(
  supabase: Supabase,
  path: string,
): Promise<Uint8Array | "missing" | "failed"> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .download(path);
  if (error) {
    if (error.message === "Object not found") return "missing";
    console.error("Reading a Material's file failed", error);
    return "failed";
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Renames one of the Student's Materials. False when it is missing or not theirs. */
export async function updateMaterialName(
  supabase: Supabase,
  materialId: string,
  name: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("materials")
    .update({ name })
    .eq("id", materialId)
    .select("id");
  if (error) failed("Renaming the Material", error);
  return data.length > 0;
}

/** Deletes one of the Student's Materials, without its file. */
export async function removeMaterial(
  supabase: Supabase,
  materialId: string,
): Promise<void> {
  const { error } = await supabase
    .from("materials")
    .delete()
    .eq("id", materialId);
  if (error) failed("Deleting the Material", error);
}

/**
 * A link to one of the Student's Material files that works for
 * `expiresInSeconds`, or null when the file is missing or not theirs.
 */
export async function signFileUrl(
  supabase: Supabase,
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) {
    console.error("Signing a Material's link failed", error);
    return null;
  }
  return data.signedUrl;
}

/** The Course's Materials, newest first. */
export async function listMaterials(
  supabase: Supabase,
  courseId: string,
): Promise<MaterialListItem[]> {
  const { data, error } = await supabase
    .from("materials")
    .select(
      "id, name, media_type, size_bytes, created_at, parse_status, pages_done, pages_total, parse_failure, parse_start_failed",
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) failed("Loading the Materials", error);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    parse: {
      status: row.parse_status as ParseStatus,
      pagesDone: row.pages_done,
      pagesTotal: row.pages_total,
      failure: row.parse_failure,
      startFailed: row.parse_start_failed,
    },
  }));
}
