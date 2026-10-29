import "server-only";
import type { Database, Json } from "@/lib/supabase/database.types";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";
import { loadAdminChunks } from "@/features/ingestion/server";
import { distinctAdminTexts } from "@/features/brief/domain/admin-texts";
import { oldExamQuestion } from "@/features/brief/domain/old-exams";
import {
  OPENING_MESSAGE,
  oldExamsMessageId,
  openingMessageId,
} from "@/features/brief/domain/opening";
import { STATIC_MODEL_ID } from "@/features/brief/domain/static-messages";
import {
  isIntakeDone,
  type BriefBigIdea,
  type BriefContext,
  type BriefFields,
  type BriefMaterial,
  type ReservedExam,
} from "@/features/brief/domain/intake";
import { loadExamScopes } from "@/features/brief/server/exam-scopes";
import type { BriefUIMessage } from "@/features/brief/types";

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
 * Opens the Course's Brief as its page does: creates it if needed, asks
 * about Materials parsed after intake (`askOldExams`) and returns the
 * messages. Null when the Course is not the Student's.
 */
export async function openBrief(
  supabase: Supabase,
  courseId: string,
): Promise<BriefUIMessage[] | null> {
  if (!(await ensureBrief(supabase, courseId))) return null;
  await askOldExams(supabase, courseId);
  return loadMessages(supabase, courseId);
}

/**
 * Once intake is done, posts one static message, with no model call, that
 * asks whether the parsed Materials not asked yet are old exams. Safe to
 * call concurrently: the message's id derives from the Materials', so it is
 * stored once. The answer goes through `saveBrief`, which marks them asked.
 */
async function askOldExams(
  supabase: Supabase,
  courseId: string,
): Promise<void> {
  const [brief, materials] = await Promise.all([
    loadBrief(supabase, courseId),
    loadMaterials(supabase, courseId),
  ]);
  if (!brief || !isIntakeDone(brief.fields)) return;
  const unasked = materials.filter(
    (material) => material.parsed && !material.examAsked,
  );
  if (unasked.length === 0) return;

  const { error } = await supabase.from("brief_messages").insert({
    id: oldExamsMessageId(unasked.map(({ id }) => id)),
    course_id: courseId,
    role: "assistant",
    parts: [{ type: "text", text: oldExamQuestion(unasked) }],
    model_id: STATIC_MODEL_ID,
  });
  if (error && error.code !== "23505") failed("Asking about old exams", error);
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

/** The Course's Materials, oldest upload first, with their old-exam state. */
async function loadMaterials(supabase: Supabase, courseId: string) {
  const { data, error } = await supabase
    .from("materials")
    .select("id, name, parse_status, is_exam, exam_asked")
    .eq("course_id", courseId)
    .order("created_at");
  if (error) failed("Loading the Materials", error);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    parsed: row.parse_status === "parsed",
    exam: row.is_exam === true,
    examAsked: row.exam_asked === true,
  }));
}

/** The Course's Big ideas with their Topics, in Course order. */
export async function loadBigIdeas(
  supabase: Supabase,
  courseId: string,
): Promise<BriefBigIdea[]> {
  const [bigIdeas, topics] = await Promise.all([
    allRows("Loading the big ideas", (from, to) =>
      supabase
        .from("big_ideas")
        .select("id, name")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the topics", (from, to) =>
      supabase
        .from("topics")
        .select("id, name, big_idea_id")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
  ]);
  return bigIdeas.map(({ id, name }) => ({
    id,
    name,
    topics: topics
      .filter((topic) => topic.big_idea_id === id)
      .map((topic) => ({ id: topic.id, name: topic.name })),
  }));
}

/**
 * What the AI is told about the Course's Brief: its fields and notes, the
 * Course's Materials, oldest first, each marked when the exam excludes it or
 * it is an old exam, its Big ideas and Topics, the exam scopes and the
 * distinct admin texts. Null when the Course has no Brief.
 */
export async function loadContext(
  supabase: Supabase,
  courseId: string,
): Promise<BriefContext | null> {
  const [brief, materials, excluded, bigIdeas, examScopes, adminChunks] =
    await Promise.all([
      loadBrief(supabase, courseId),
      loadMaterials(supabase, courseId),
      loadExcludedIds(supabase, courseId),
      loadBigIdeas(supabase, courseId),
      loadExamScopes(supabase, courseId),
      loadAdminChunks(supabase, courseId),
    ]);
  if (!brief) return null;
  const briefMaterials: BriefMaterial[] = materials.map(
    ({ id, name, exam, examAsked }) => ({
      id,
      name,
      excluded: excluded.has(id),
      exam,
      examAsked,
    }),
  );
  return {
    ...brief,
    materials: briefMaterials,
    exams: materials
      .filter(({ exam }) => exam)
      .map(({ id, name }) => ({ id, name })),
    bigIdeas,
    examScopes,
    adminTexts: distinctAdminTexts(adminChunks),
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
 * `excludedMaterialIds` the Materials the exam excludes and
 * `examMaterialIds` the Course's old exams (all Materials of the Course).
 * All or nothing, in one transaction (`save_brief`); throws when it fails.
 */
export async function saveBrief(
  supabase: Supabase,
  courseId: string,
  fields: BriefFieldsUpdate,
  {
    excludedMaterialIds,
    examMaterialIds,
  }: { excludedMaterialIds: string[] | null; examMaterialIds: string[] | null },
): Promise<void> {
  const { data, error } = await supabase.rpc("save_brief", {
    course_id: courseId,
    fields,
    ...(excludedMaterialIds && { excluded_material_ids: excludedMaterialIds }),
    ...(examMaterialIds && { exam_material_ids: examMaterialIds }),
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
