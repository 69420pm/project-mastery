import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseMaterial } from "@/features/ingestion/server";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { Json } from "@/lib/supabase/database.types";
import type { SmokeCheck } from "./smoke-check";

/**
 * The recorded gold page results (`evals/gold/linear-algebra-I/pages.json`,
 * slice 6 of #222) and how a smoke check parses them without page calls.
 */

export const GOLD = "evals/gold/linear-algebra-I";

/** One recorded page call's result. */
export type RecordedPage = {
  page_number: number;
  skipped: string | null;
  language: string | null;
  units: Array<{ label: string; exerciseNumber: string | null }>;
};

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

/** The recorded pages of a gold PDF, such as "exercises.pdf". */
export async function recordedPages(file: string) {
  const recording = JSON.parse(
    await readFile(`${GOLD}/pages.json`, "utf8"),
  ) as Record<string, RecordedPage[]>;
  const pages = recording[file] ?? [];
  return (number: number) => {
    const found = pages.find((p) => p.page_number === number);
    if (!found) throw new Error(`pages.json has no page ${number} of ${file}.`);
    return found;
  };
}

export async function createCourse(
  supabase: Supabase,
  studentId: string,
  name: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .insert({ owner: studentId, name })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * A Material of the whole PDF whose given pages have their recorded
 * results, parsed with only those pages, so no page is read again.
 */
export async function parseSeeded(
  {
    supabase,
    studentId,
    pdf,
  }: { supabase: Supabase; studentId: string; pdf: Uint8Array },
  courseId: string,
  name: string,
  pages: RecordedPage[],
) {
  const materialId = randomUUID();
  const storagePath = `${studentId}/${courseId}/${materialId}`;
  const upload = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  if (upload.error) throw new Error(upload.error.message);
  const material = await supabase.from("materials").insert({
    id: materialId,
    owner: studentId,
    course_id: courseId,
    name,
    media_type: "application/pdf",
    size_bytes: pdf.byteLength,
    storage_path: storagePath,
  });
  if (material.error) throw new Error(material.error.message);
  const seeded = await supabase.from("material_pages").insert(
    pages.map((page) => ({
      owner: studentId,
      material_id: materialId,
      page_number: page.page_number,
      skipped: page.skipped,
      language: page.language,
      units: page.units as Json[],
    })),
  );
  if (seeded.error) throw new Error(seeded.error.message);
  await parseMaterial(materialId, {
    pages: pages.map((page) => page.page_number),
  });
}

/** How many model calls the Student's runs recorded, of one task or all. */
export async function recordedCalls(
  supabase: Supabase,
  studentId: string,
  task?: string,
) {
  let query = supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("owner", studentId);
  if (task) query = query.eq("task", task);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
