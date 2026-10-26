import "server-only";
import type { Database, Json } from "@/lib/supabase/database.types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";
import { getMaterialList } from "@/features/courses/server";
import { findingQuestion } from "@/features/brief/domain/findings";
import {
  findingMessageId,
  OPENING_MESSAGE,
  openingMessageId,
} from "@/features/brief/domain/opening";
import { STATIC_MODEL_ID } from "@/features/brief/domain/static-messages";
import {
  asksFindings,
  type BriefContext,
  type BriefFields,
  type ExamMaterial,
  type ReservedExam,
} from "@/features/brief/domain/intake";
import type { BriefUIMessage } from "@/features/brief/types";
import {
  getOpenFindings,
  markFindingAsked,
} from "@/features/knowledge-map/server";

/**
 * Reads and writes Briefs and their messages as the signed-in Student, so Row
 * Level Security applies: another Student's Brief reads as missing.
 */

type MessageRow = Database["public"]["Tables"]["brief_messages"]["Row"];

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
  if (error && error.code !== "23505") failed("Creating the Brief", error);

  const { error: openingError } = await supabase.from("brief_messages").insert({
    id: openingMessageId(courseId),
    course_id: courseId,
    role: "assistant",
    parts: [{ type: "text", text: OPENING_MESSAGE }],
    model_id: STATIC_MODEL_ID,
  });
  if (openingError && openingError.code !== "23505") {
    failed("Saving the opening message", openingError);
  }
  return true;
}

/**
 * Opens the Course's Brief as its page does: creates it if needed, posts the
 * next open Finding (`askNextFinding`) and returns the messages. Null when
 * the Course is not the Student's.
 */
export async function openBrief(
  supabase: Supabase,
  courseId: string,
): Promise<BriefUIMessage[] | null> {
  if (!(await ensureBrief(supabase, courseId))) return null;
  await askNextFinding(supabase, courseId);
  return loadMessages(supabase, courseId);
}

/**
 * Posts the next open Finding of the Course as a static AI message, with no
 * model call, and marks it asked: once intake is done, while no asked Finding
 * waits for an answer. Safe to call concurrently: the message's id derives
 * from the Finding's, so it is stored once.
 */
async function askNextFinding(
  supabase: Supabase,
  courseId: string,
): Promise<void> {
  const [brief, exams] = await Promise.all([
    loadBrief(supabase, courseId),
    loadExams(supabase, courseId),
  ]);
  if (!brief || !asksFindings(brief.fields, exams, brief.reservedExam)) {
    return;
  }
  const findings = await getOpenFindings(supabase, courseId);
  const next = findings[0];
  if (!next || findings.some(({ asked }) => asked)) return;

  const { error } = await supabase.from("brief_messages").insert({
    id: findingMessageId(next.id),
    course_id: courseId,
    role: "assistant",
    parts: [{ type: "text", text: findingQuestion(next) }],
    model_id: STATIC_MODEL_ID,
  });
  if (error && error.code !== "23505") failed("Asking the Finding", error);
  await markFindingAsked(supabase, courseId, next.id);
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
  if (error) failed("Loading the messages", error);
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
  if (error) failed("Saving the message", error);
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
      "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes, reserved_exam_material_id, reserved_exam_answered",
    )
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) failed("Loading the Brief", error);
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
  const reservedExam: ReservedExam = {
    answered: data.reserved_exam_answered === true,
    materialId: data.reserved_exam_material_id ?? null,
  };
  return { fields, notes: data.notes, reservedExam };
}

/** The Course's old exams, oldest upload first. */
async function loadExams(
  supabase: Supabase,
  courseId: string,
): Promise<ExamMaterial[]> {
  return examsOf(await getMaterialList(courseId, supabase));
}

function examsOf(
  materials: Awaited<ReturnType<typeof getMaterialList>>,
): ExamMaterial[] {
  return materials
    .toReversed()
    .flatMap(({ id, name, exam }) =>
      exam
        ? [{ id, name, year: exam.year, totalPoints: exam.totalPoints }]
        : [],
    );
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
    getMaterialList(courseId, supabase),
    loadExcludedIds(supabase, courseId),
  ]);
  if (!brief) return null;
  const exams = examsOf(materials);
  return {
    ...brief,
    exams,
    findings: asksFindings(brief.fields, exams, brief.reservedExam)
      ? await getOpenFindings(supabase, courseId)
      : [],
    // Oldest first, as the Student uploaded them.
    materials: materials.toReversed().map(({ id, name }) => ({
      id,
      name,
      excluded: excluded.has(id),
    })),
  };
}

async function loadExcludedIds(supabase: Supabase, courseId: string) {
  const { data, error } = await supabase
    .from("brief_excluded_materials")
    .select("material_id")
    .eq("course_id", courseId);
  if (error) failed("Loading the excluded Materials", error);
  return new Set(data.map((row) => row.material_id));
}

/** The fixed fields `saveBrief` can change, by column. */
export type BriefFieldsUpdate = Pick<
  BriefUpdate,
  | "exam_date"
  | "goal"
  | "hours_per_week"
  | "question_style"
  | "open_book"
  | "formula_sheet"
  | "calculator"
  | "scope_confirmed"
  | "reserved_exam_material_id"
  | "reserved_exam_answered"
>;

/**
 * Changes the given fields of the Course's Brief and, unless null, makes
 * `excludedMaterialIds` (Materials of the Course) the ones the exam excludes.
 * All or nothing, in one transaction (`save_brief`); throws when it fails.
 */
export async function saveBrief(
  supabase: Supabase,
  courseId: string,
  fields: BriefFieldsUpdate,
  excludedMaterialIds: string[] | null,
): Promise<void> {
  const { data, error } = await supabase.rpc("save_brief", {
    course_id: courseId,
    fields,
    ...(excludedMaterialIds && { excluded_material_ids: excludedMaterialIds }),
  });
  if (error) failed("Saving the Brief", error);
  if (!data) throw new Error("Saving the Brief failed: it does not exist");
}

/**
 * Appends `text` to the notes of the Course's Brief after a blank line, in one
 * update (`add_brief_note`), so concurrent calls keep every statement. False
 * when the notes would grow too long, and nothing changed.
 */
export async function addBriefNote(
  supabase: Supabase,
  courseId: string,
  text: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("add_brief_note", {
    course_id: courseId,
    text,
  });
  if (error) failed("Saving the note", error);
  if (data === null) throw new Error("Saving the note failed: no Brief");
  return data;
}
