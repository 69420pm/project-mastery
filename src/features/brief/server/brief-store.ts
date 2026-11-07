import "server-only";
import type { Database, Json } from "@/lib/supabase/database.types";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";
import {
  loadAdminChunks,
  loadCourseLanguage,
} from "@/features/ingestion/server";
import { distinctAdminTexts } from "@/features/brief/domain/admin-texts";
import {
  briefChapters,
  confirmedExams,
  oldExamQuestion,
  oldExamsPart,
  unaskedExams,
  type StoredChapter,
} from "@/features/brief/domain/old-exams";
import {
  OPENING_MESSAGE,
  oldExamsMessageId,
  openingMessageId,
} from "@/features/brief/domain/opening";
import { STATIC_MODEL_ID } from "@/features/brief/domain/static-messages";
import {
  isIntakeDone,
  type BriefTopic,
  type BriefContext,
  type BriefFields,
  type BriefMaterial,
  type ExamChapter,
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
 * asks whether the Chapters that look like old exams and were not asked
 * about yet are ones (`unaskedExams`). Safe to call concurrently: the
 * message's id derives from the Chapters', so it is stored once. It
 * carries their ids in a data part, which the model does not see, so the
 * answer marks only them asked (`askedChapterIds`).
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
  const unasked = unaskedExams(materials);
  if (unasked.length === 0) return;

  const { error } = await supabase.from("brief_messages").insert({
    id: oldExamsMessageId(unasked.map(({ id }) => id)),
    course_id: courseId,
    role: "assistant",
    parts: [
      { type: "text", text: oldExamQuestion(unasked) },
      oldExamsPart(unasked.map(({ id }) => id)),
    ],
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
      "exam_date, goal, open_book, formula_sheet, calculator, scope_confirmed, notes, reserved_exam_chapter_id, reserved_exam_answered",
    )
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) failed("Loading the Brief", error);
  if (!data) return null;
  const fields: BriefFields = {
    examDate: data.exam_date,
    goal: data.goal as BriefFields["goal"],
    openBook: data.open_book,
    formulaSheet: data.formula_sheet,
    calculator: data.calculator,
    scopeConfirmed: data.scope_confirmed,
  };
  const reservedExam: ReservedExam = {
    answered: data.reserved_exam_answered === true,
    chapterId: data.reserved_exam_chapter_id ?? null,
  };
  return { fields, notes: data.notes, reservedExam };
}

/**
 * The Course's Materials, oldest upload first, each with its Chapters in
 * reading order and their old-exam state.
 */
async function loadMaterials(supabase: Supabase, courseId: string) {
  const [materials, chapters] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name, parse_status")
      .eq("course_id", courseId)
      .order("created_at"),
    allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select(
          "id, material_id, parent_id, position, title, depth, exam_proposed, is_exam, exam_asked",
        )
        .eq("course_id", courseId)
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  return materials.data.map((row) => ({
    id: row.id,
    name: row.name,
    parsed: row.parse_status === "parsed",
    chapters: chapters
      .filter((chapter) => chapter.material_id === row.id)
      .map((chapter): StoredChapter => ({
        id: chapter.id,
        parentId: chapter.parent_id,
        title: chapter.title,
        depth: chapter.depth,
        examProposed: chapter.exam_proposed,
        exam: chapter.is_exam,
        examAsked: chapter.exam_asked,
      })),
  }));
}

/** The Course's Topic tree in tree order, each Topic with its depth. */
export async function loadTopics(
  supabase: Supabase,
  courseId: string,
): Promise<BriefTopic[]> {
  const topics = await allRows("Loading the topics", (from, to) =>
    supabase
      .from("topics")
      .select("id, name, parent_id")
      .eq("course_id", courseId)
      .order("position")
      .range(from, to),
  );
  const depth = new Map<string, number>();
  return topics.map(({ id, name, parent_id }) => {
    const own = parent_id ? (depth.get(parent_id) ?? 0) + 1 : 0;
    depth.set(id, own);
    return { id, name, depth: own };
  });
}

/**
 * What the AI is told about the Course's Brief: its fields and notes, the
 * Course's Materials, oldest first, each marked when the exam excludes it
 * and with its Chapters and their old-exam state, the old exams, the
 * Course language, its Topic tree, the exam scopes and the distinct admin
 * texts. Null when the Course has no Brief.
 */
export async function loadContext(
  supabase: Supabase,
  courseId: string,
): Promise<BriefContext | null> {
  const [
    brief,
    materials,
    excluded,
    topics,
    examScopes,
    adminChunks,
    language,
  ] = await Promise.all([
    loadBrief(supabase, courseId),
    loadMaterials(supabase, courseId),
    loadExcludedIds(supabase, courseId),
    loadTopics(supabase, courseId),
    loadExamScopes(supabase, courseId),
    loadAdminChunks(supabase, courseId),
    loadCourseLanguage(supabase, courseId),
  ]);
  if (!brief) return null;
  const briefMaterials: BriefMaterial[] = materials.map(
    ({ id, name, chapters }) => ({
      id,
      name,
      excluded: excluded.has(id),
      chapters: briefChapters(chapters),
    }),
  );
  return {
    ...brief,
    materials: briefMaterials,
    exams: confirmedExams(materials),
    language,
    topics,
    examScopes,
    adminTexts: distinctAdminTexts(adminChunks),
  };
}

/**
 * The Course's old exams (`confirmedExams`), read with `supabase`, a
 * Student's session client.
 */
export async function loadOldExams(
  supabase: Supabase,
  courseId: string,
): Promise<Array<ExamChapter & { materialId: string }>> {
  const materials = await loadMaterials(supabase, courseId);
  return materials.flatMap((material) =>
    confirmedExams([material]).map((exam) => ({
      ...exam,
      materialId: material.id,
    })),
  );
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
  | "open_book"
  | "formula_sheet"
  | "calculator"
  | "scope_confirmed"
  | "reserved_exam_chapter_id"
  | "reserved_exam_answered"
>;

/**
 * Changes the given fields of the Course's Brief and, unless null, makes
 * `excludedMaterialIds` the Materials the exam excludes,
 * `examChapterIds` the Course's old-exam Chapters (others that were one,
 * or that are among `askedChapterIds`, become none) and `language` the
 * Course language, marking the Chapters of parsed Materials among
 * `askedChapterIds` asked. All or nothing, in one transaction
 * (`save_brief`); throws when it fails.
 */
export async function saveBrief(
  supabase: Supabase,
  courseId: string,
  fields: BriefFieldsUpdate,
  {
    excludedMaterialIds,
    examChapterIds,
    askedChapterIds = [],
    language = null,
  }: {
    excludedMaterialIds: string[] | null;
    examChapterIds: string[] | null;
    askedChapterIds?: string[];
    language?: string | null;
  },
): Promise<void> {
  const { data, error } = await supabase.rpc("save_brief", {
    course_id: courseId,
    fields,
    ...(excludedMaterialIds && { excluded_material_ids: excludedMaterialIds }),
    ...(examChapterIds && {
      exam_chapter_ids: examChapterIds,
      asked_chapter_ids: askedChapterIds,
    }),
    ...(language && { course_language: language }),
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

/**
 * `addBriefNote` from outside the Brief, such as a Topic skip's reason.
 * False, changing nothing, when the notes would grow too long or the
 * Course has no Brief yet.
 */
export async function noteInBrief(
  supabase: Supabase,
  courseId: string,
  text: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("add_brief_note", {
    course_id: courseId,
    text,
  });
  if (error) failed("Saving the note", error);
  return data === true;
}
