import "server-only";
import { z } from "zod";
import { briefPath } from "@/features/brief/domain/brief-paths";
import { isIntakeDone } from "@/features/brief/domain/intake";
import type { BriefFields } from "@/features/brief/domain/intake";
import {
  loadBigIdeas,
  loadFields,
  openBrief,
} from "@/features/brief/server/brief-store";
import { loadExamScopes } from "@/features/brief/server/exam-scopes";
import type { BriefWithMessages, ExamFacts } from "@/features/brief/types";
import { materialChunksPath } from "@/features/courses/server";
import { getUser, requireUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The signed-in Student's Brief of a Course with its messages, created with
 * its static opening message when the Course has none yet, and with the
 * old-exam question posted for Materials parsed after intake (`openBrief`).
 * Null when the id is malformed or the Course is unknown or another
 * Student's (show not-found).
 */
export async function getBrief(
  courseId: string,
): Promise<BriefWithMessages | null> {
  await requireUser(briefPath(courseId));
  if (!z.uuid().safeParse(courseId).success) return null;

  const supabase = await createClient();
  const messages = await openBrief(supabase, courseId);
  if (!messages) return null;
  const panel = await loadPanelData(supabase, courseId);
  return { courseId, messages, ...panel };
}

/** What the Brief's panel shows of the Brief itself. */
async function loadPanelData(supabase: Supabase, courseId: string) {
  const [brief, excluded, exams, bigIdeas, scopes] = await Promise.all([
    supabase
      .from("briefs")
      .select(
        "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes, notes_updated_at, reserved_exam_answered, reserved_exam_material_id",
      )
      .eq("course_id", courseId)
      .single(),
    supabase
      .from("brief_excluded_materials")
      .select("material_id, materials(id, name, created_at)")
      .eq("course_id", courseId),
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .eq("is_exam", true)
      .order("created_at"),
    loadBigIdeas(supabase, courseId),
    loadExamScopes(supabase, courseId),
  ]);
  if (exams.error) failed("Loading the old exams", exams.error);
  if (brief.error) {
    throw new Error(`Loading the Brief failed: ${brief.error.message}`);
  }
  if (excluded.error) {
    throw new Error(
      `Loading the excluded Materials failed: ${excluded.error.message}`,
    );
  }
  const { data } = brief;
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
  const excludedMaterials = excluded.data
    .flatMap((row) => row.materials ?? [])
    .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ id, name }) => ({
      id,
      name,
      href: materialChunksPath(courseId, id),
    }));
  return {
    fields,
    notes: data.notes,
    notesUpdatedAt: data.notes_updated_at,
    excludedMaterials,
    oldExams: exams.data.map(({ id, name }) => ({
      id,
      name,
      href: materialChunksPath(courseId, id),
    })),
    examScopes: scopes.flatMap(({ bigIdeaId, topicId, scope, words }) => {
      const bigIdea = bigIdeas.find(({ id }) => id === bigIdeaId);
      const topic = bigIdeas
        .flatMap(({ topics }) => topics)
        .find(({ id }) => id === topicId);
      const name = bigIdea?.name ?? topic?.name;
      return name === undefined ? [] : [{ name, scope, words }];
    }),
    reservedExam: data.reserved_exam_answered
      ? await loadReservedExamLink(
          supabase,
          courseId,
          data.reserved_exam_material_id,
        )
      : null,
  };
}

async function loadReservedExamLink(
  supabase: Supabase,
  courseId: string,
  materialId: string | null,
): Promise<BriefWithMessages["reservedExam"]> {
  if (materialId === null) return "none";
  const { data, error } = await supabase
    .from("materials")
    .select("name")
    .eq("id", materialId)
    .maybeSingle();
  if (error) failed("Loading the reserved exam", error);
  return data
    ? { name: data.name, href: materialChunksPath(courseId, materialId) }
    : "none";
}

/**
 * The exam date, weekly hours and goal of a Course's Brief, read with
 * `supabase`, a Student's session client; each null when not set or without
 * a Brief.
 */
export async function getExamFacts(
  supabase: Supabase,
  courseId: string,
): Promise<ExamFacts> {
  const { data, error } = await supabase
    .from("briefs")
    .select("exam_date, hours_per_week, goal")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw new Error(`Loading the Brief failed: ${error.message}`);
  return {
    examDate: data?.exam_date ?? null,
    hoursPerWeek:
      data?.hours_per_week == null ? null : Number(data.hours_per_week),
    goal: (data?.goal ?? null) as ExamFacts["goal"],
  };
}

/**
 * The Brief's answers on the exam's aids, read with `supabase`, a Student's
 * session client or the admin client; each null when not answered or
 * without a Brief.
 */
export async function getExamAids(
  supabase: Supabase,
  courseId: string,
): Promise<Pick<BriefFields, "openBook" | "formulaSheet" | "calculator">> {
  const { data, error } = await supabase
    .from("briefs")
    .select("open_book, formula_sheet, calculator")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) failed("Loading the exam's aids", error);
  return {
    openBook: data?.open_book ?? null,
    formulaSheet: data?.formula_sheet ?? null,
    calculator: data?.calculator ?? null,
  };
}

/**
 * The Course's active reserved exam Material, read with `supabase`, a
 * Student's session client or the admin client; null when none is reserved,
 * once a submitted Mock exam has used it, or without a Brief. While it is
 * active, the tutor, problem generation and every mock but the final one
 * leave its Exercises and chunks out.
 */
export async function getReservedExam(
  supabase: Supabase,
  courseId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("reserved_exam_material_id")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) failed("Loading the reserved exam", error);
  const materialId = data?.reserved_exam_material_id ?? null;
  if (materialId === null) return null;
  const used = await supabase
    .from("mock_exams")
    .select("id")
    .eq("course_id", courseId)
    .eq("reserved_material_id", materialId)
    .eq("status", "submitted")
    .limit(1);
  if (used.error) failed("Loading the final mock exam", used.error);
  return used.data.length > 0 ? null : materialId;
}

/**
 * Whether the Student has finished telling the AI about the Course's exam
 * (`isIntakeDone`). False without a Brief or a signed-in Student.
 */
export async function getIntakeDone(courseId: string): Promise<boolean> {
  if (!z.uuid().safeParse(courseId).success) return false;
  if (!(await getUser())) return false;
  return isIntakeDone(await loadFields(await createClient(), courseId));
}
