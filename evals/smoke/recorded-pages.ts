import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseMaterial, type OutlineAnswer } from "@/features/ingestion/server";
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
  units: Array<Record<string, unknown>>;
};

type Supabase = Parameters<SmokeCheck["run"]>[0]["supabase"];

/** A gold PDF's recording: its pages and its structure call's Outline. */
type Recording = { pages: RecordedPage[]; outline: OutlineAnswer | null };

async function recording(file: string): Promise<Recording> {
  const recorded = JSON.parse(
    await readFile(`${GOLD}/pages.json`, "utf8"),
  ) as Record<string, Recording>;
  return recorded[file] ?? { pages: [], outline: null };
}

/** The recorded pages of a gold PDF, such as "exercises.pdf". */
export async function recordedPages(file: string) {
  const { pages } = await recording(file);
  return (number: number) => {
    const found = pages.find((p) => p.page_number === number);
    if (!found) throw new Error(`pages.json has no page ${number} of ${file}.`);
    return found;
  };
}

/** The Outline the structure call gave a gold PDF's recorded pages. */
export async function recordedOutline(file: string) {
  return (await recording(file)).outline ?? NO_OUTLINE;
}

/** An Outline of only the root Chapter, without language and notes. */
const NO_OUTLINE: OutlineAnswer = { language: null, notes: null, chapters: [] };

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
 * results, parsed with only those pages and with `outline` instead of the
 * structure call, so no page is read again and no Outline is asked for.
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
  outline: OutlineAnswer = NO_OUTLINE,
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
      units: page.units as Json[],
    })),
  );
  if (seeded.error) throw new Error(seeded.error.message);
  for (let attempt = 1; ; attempt++) {
    await parseMaterial(materialId, {
      pages: pages.map((page) => page.page_number),
      outline,
    });
    const { data, error } = await supabase
      .from("materials")
      .select("parse_status, parse_failure")
      .eq("id", materialId)
      .single();
    if (error) throw new Error(error.message);
    if (data.parse_status !== "failed" || attempt === PARSE_ATTEMPTS) return;
    // In process, a step's RetryableError (such as the Gateway's 5 requests
    // per minute on an embedding) fails the parse instead of retrying the
    // step after the delay, as the Workflow runtime does. Parse again, as a
    // Student would, once the minute is over.
    console.info(`  ${name}: ${data.parse_failure} Parsing again in a minute…`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

/** How often a seeded Material is parsed before its failure stands. */
const PARSE_ATTEMPTS = 2;
const RETRY_MS = 60_000;

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
