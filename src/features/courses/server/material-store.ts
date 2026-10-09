import "server-only";
import {
  courseFolder,
  MATERIALS_BUCKET,
} from "@/features/courses/domain/material-storage";
import type {
  MaterialListItem,
  StoredMaterial,
} from "@/features/courses/types";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Reads and writes Materials and their files as the signed-in Student, so
 * Row Level Security and the bucket policies apply: another Student's
 * Material reads as missing.
 */

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

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
 * Removes every file in a Course's folder, including files whose upload was
 * never registered as a Material. True when they are gone, false when
 * Storage failed.
 */
export async function removeCourseFiles(
  supabase: Supabase,
  owner: string,
  courseId: string,
): Promise<boolean> {
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  const folder = courseFolder(owner, courseId);
  for (;;) {
    // Each round lists from the start, since the last round removed its page.
    const { data, error } = await bucket.list(folder, {
      limit: LIST_PAGE_SIZE,
    });
    if (error) {
      console.error("Listing a Course's files failed", error);
      return false;
    }
    if (data.length === 0) return true;
    const removed = await removeStoredFiles(
      supabase,
      data.map((file) => `${folder}/${file.name}`),
    );
    if (!removed) return false;
    if (data.length < LIST_PAGE_SIZE) return true;
  }
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
  fail("Registering the Material", error);
}

/** The Student's Material with this id, or null when it is missing or not theirs. */
export async function findMaterial(
  supabase: Supabase,
  materialId: string,
): Promise<{
  name: string;
  mediaType: string;
  storagePath: string;
} | null> {
  const { data, error } = await supabase
    .from("materials")
    .select("name, media_type, storage_path")
    .eq("id", materialId)
    .maybeSingle();
  if (error) fail("Loading the Material", error);
  return (
    data && {
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
  if (error) fail("Loading the Materials", error);
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

/**
 * How many of the Student's Chats have a message that attaches the Material,
 * as a `data-material` part holding a `MaterialReference`.
 */
export async function countChatsAttaching(
  supabase: Supabase,
  materialId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("chat_id")
    // As JSON text: postgrest-js sends arrays as Postgres array literals.
    .contains(
      "parts",
      JSON.stringify([{ type: "data-material", data: { materialId } }]),
    );
  if (error) fail("Counting the Chats with the Material", error);
  return new Set(data.map((row) => row.chat_id)).size;
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
  if (error) fail("Renaming the Material", error);
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
  if (error) fail("Deleting the Material", error);
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
    .select("id, name, media_type, size_bytes, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) fail("Loading the Materials", error);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }));
}
