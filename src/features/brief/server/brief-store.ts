import "server-only";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/types";
import {
  OPENING_MESSAGE,
  OPENING_MODEL_ID,
  openingMessageId,
} from "@/features/brief/domain/opening";
import type { BriefContext, BriefFields } from "@/features/brief/domain/intake";
import type { BriefUIMessage } from "@/features/brief/types";

/**
 * Reads and writes Briefs and their messages as the signed-in Student, so Row
 * Level Security applies: another Student's Brief reads as missing.
 */

type MessageRow = Database["public"]["Tables"]["brief_messages"]["Row"];

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/**
 * Creates the Course's Brief and its static opening message when they do not
 * exist yet. Returns false when the Course is not (or no longer) the
 * Student's. Safe to call concurrently: each insert is stored once.
 */
export async function ensureBrief(
  supabase: Supabase,
  courseId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("briefs")
    .insert({ course_id: courseId });
  // 23505: it exists. The insert policy and the foreign key refuse a Course
  // that is not the Student's or was deleted.
  if (error?.code === "42501" || error?.code === "23503") return false;
  if (error && error.code !== "23505") fail("Creating the Brief", error);

  const { error: openingError } = await supabase.from("brief_messages").insert({
    id: openingMessageId(courseId),
    course_id: courseId,
    role: "assistant",
    parts: [{ type: "text", text: OPENING_MESSAGE }],
    model_id: OPENING_MODEL_ID,
  });
  if (openingError && openingError.code !== "23505") {
    fail("Saving the opening message", openingError);
  }
  return true;
}

function toUIMessage(row: MessageRow): BriefUIMessage {
  const message = {
    id: row.id,
    role: row.role as BriefUIMessage["role"],
    parts: row.parts as unknown as BriefUIMessage["parts"],
  };
  return row.role === "assistant"
    ? {
        ...message,
        metadata: { ...(row.model_id && { modelId: row.model_id }) },
      }
    : message;
}

/** A Brief's messages in order. Not validated: run `validateUIMessages` before model calls. */
export async function loadMessages(
  supabase: Supabase,
  courseId: string,
): Promise<BriefUIMessage[]> {
  const { data, error } = await supabase
    .from("brief_messages")
    .select("id, course_id, owner, role, parts, model_id, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  if (error) fail("Loading the messages", error);
  return data.map(toUIMessage);
}

/**
 * Stores a message. Returns false when its id is taken, by a message of the
 * Brief or by one the Student cannot see.
 */
export async function saveMessage(
  supabase: Supabase,
  courseId: string,
  message: BriefUIMessage,
): Promise<boolean> {
  const { error } = await supabase.from("brief_messages").insert({
    id: message.id,
    course_id: courseId,
    role: message.role,
    parts: message.parts as unknown as Json[],
    model_id: message.metadata?.modelId ?? null,
  });
  if (error?.code === "23505") return false;
  if (error) fail("Saving the message", error);
  return true;
}

type BriefUpdate = Database["public"]["Tables"]["briefs"]["Update"];

/** The Course's Brief fields, or null when it has no Brief yet. */
export async function loadFields(
  supabase: Supabase,
  courseId: string,
): Promise<BriefFields | null> {
  return (await loadBrief(supabase, courseId))?.fields ?? null;
}

async function loadBrief(supabase: Supabase, courseId: string) {
  const { data, error } = await supabase
    .from("briefs")
    .select(
      "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes",
    )
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) fail("Loading the Brief", error);
  if (!data) return null;
  const fields: BriefFields = {
    examDate: data.exam_date,
    goal: data.goal as BriefFields["goal"],
    hoursPerWeek: data.hours_per_week,
    questionStyle: data.question_style as BriefFields["questionStyle"],
    openBook: data.open_book,
    formulaSheet: data.formula_sheet,
    calculator: data.calculator,
    scopeConfirmed: data.scope_confirmed,
  };
  return { fields, notes: data.notes };
}

/**
 * What the AI is told about the Course's Brief: its fields and notes, and the
 * Course's Materials, oldest first, each marked when the exam excludes it.
 * Null when the Course has no Brief.
 */
export async function loadContext(
  supabase: Supabase,
  courseId: string,
): Promise<BriefContext | null> {
  const [brief, materials, excluded] = await Promise.all([
    loadBrief(supabase, courseId),
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true }),
    loadExcludedIds(supabase, courseId),
  ]);
  if (materials.error) fail("Loading the Materials", materials.error);
  if (!brief) return null;
  return {
    ...brief,
    materials: materials.data.map(({ id, name }) => ({
      id,
      name,
      excluded: excluded.has(id),
    })),
  };
}

/** The notes of the Course's Brief, null without any (or without a Brief). */
export async function loadNotes(
  supabase: Supabase,
  courseId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("notes")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) fail("Loading the notes", error);
  return data?.notes ?? null;
}

async function loadExcludedIds(supabase: Supabase, courseId: string) {
  const { data, error } = await supabase
    .from("brief_excluded_materials")
    .select("material_id")
    .eq("course_id", courseId);
  if (error) fail("Loading the excluded Materials", error);
  return new Set(data.map((row) => row.material_id));
}

/** Changes the given columns of the Course's Brief. */
export async function updateBrief(
  supabase: Supabase,
  courseId: string,
  update: Pick<
    BriefUpdate,
    | "exam_date"
    | "goal"
    | "hours_per_week"
    | "question_style"
    | "open_book"
    | "formula_sheet"
    | "calculator"
    | "scope_confirmed"
    | "notes"
  >,
): Promise<void> {
  const { error } = await supabase
    .from("briefs")
    .update(update)
    .eq("course_id", courseId);
  if (error) fail("Saving the Brief", error);
}

/** Makes `materialIds`, Materials of the Course, the ones the exam excludes. */
export async function replaceExcludedMaterials(
  supabase: Supabase,
  courseId: string,
  materialIds: string[],
): Promise<void> {
  const { error } = await supabase
    .from("brief_excluded_materials")
    .delete()
    .eq("course_id", courseId);
  if (error) fail("Including the Materials", error);
  if (materialIds.length === 0) return;
  const { error: insertError } = await supabase
    .from("brief_excluded_materials")
    .insert(
      materialIds.map((materialId) => ({
        course_id: courseId,
        material_id: materialId,
      })),
    );
  if (insertError) fail("Excluding the Materials", insertError);
}
