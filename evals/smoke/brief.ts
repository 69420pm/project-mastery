import { loadKcPriorities } from "@/features/priorities/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";
import { EXAM_TITLE, seedSmallCourse } from "./brief-course";
import { sendBriefMessage } from "./brief-send";
import { result, type SmokeCheck } from "./smoke-check";

/** What the Student tells the AI, one message per reply. */
const MESSAGES = [
  "Exam is 2026-12-03, closed book, calculator allowed. I want a good grade.",
  "Skip the lab manual. The lecturer said determinants are important.",
  `Yes, ${EXAM_TITLE} at the end of the lecture notes is an old exam, nothing else is.`,
  "Yes, Chapter 2 is not examined, leave it out.",
];

/** Sends one message through the Brief handler and returns the reply's text. */
async function send(
  client: Supabase,
  studentId: string,
  courseId: string,
  text: string,
) {
  const reply = await sendBriefMessage(client, studentId, courseId, text);
  for (const call of reply.calls) {
    console.info(`  ${call.toolName} ${JSON.stringify(call.input)}`);
    if (call.error !== undefined) {
      console.info(`  tool-output-error: ${call.error}`);
    }
  }
  for (const error of reply.errors) console.info(`  error: ${error}`);
  return reply.text;
}

/**
 * Tells the AI about an exam in a new Course's Brief, in four scripted
 * messages through the real handler: the fixed answers, the excluded lab
 * manual, the old exam, and the confirmation that Chapter 2 is not examined,
 * which an admin text says. Checks what the tools stored and that Chapter
 * 2's KCs read Priority 0. Then answers the reservation question.
 */
export const briefSmoke: SmokeCheck = {
  name: "brief",
  usage:
    "pnpm smoke brief (four scripted messages in a seeded Course's Brief: answers, old exam, exam scope; then the reserved exam)",
  // One recorded call per reply (6), with slack for retries.
  maxCalls: 12,
  async run({ supabase, studentId }) {
    const seeded = await seedSmallCourse(supabase, studentId, "Smoke check");
    const { courseId } = seeded;

    // The Brief runs as the Student, with Row Level Security as in the app.
    const client = await signInAsUser(supabase, studentId);
    for (const text of MESSAGES) {
      console.info(`Student: ${text}`);
      console.info(`AI: ${await send(client, studentId, courseId, text)}`);
    }

    const [brief, excluded, exams, scopes] = await Promise.all([
      supabase
        .from("briefs")
        .select(
          "exam_date, goal, open_book, formula_sheet, calculator, scope_confirmed, notes",
        )
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("brief_excluded_materials")
        .select("material_id")
        .eq("course_id", courseId),
      supabase
        .from("chapters")
        .select("id")
        .eq("course_id", courseId)
        .eq("is_exam", true),
      supabase
        .from("exam_scopes")
        .select("topic_id, scope, words")
        .eq("course_id", courseId),
    ]);
    for (const response of [brief, excluded, exams, scopes]) {
      if (response.error) throw new Error(response.error.message);
    }
    const b = brief.data!;
    const expected = {
      exam_date: "2026-12-03",
      goal: "good_grade",
      open_book: false,
      calculator: true,
    };
    const fields = Object.entries(expected).map(([column, value]) =>
      result(
        `${column} is ${value}`,
        b[column as keyof typeof expected] === value,
        String(b[column as keyof typeof expected]),
      ),
    );
    const excludedIds = excluded.data!.map((row) => row.material_id);
    const examIds = exams.data!.map((row) => row.id);
    const priorities = await loadKcPriorities(client, courseId);
    const chapter2 = seeded.chapter2Kcs.map((id) => priorities[id]);

    await completeIntake(supabase, courseId);
    const reservation = await answerReservation(
      supabase,
      client,
      studentId,
      courseId,
      seeded.examChapterId,
    );
    return [
      ...fields,
      // The Student never said, so the AI must not invent it.
      result(
        "formula_sheet is still unanswered",
        b.formula_sheet === null,
        String(b.formula_sheet),
      ),
      result(
        "the lab manual is excluded",
        excludedIds.length === 1 && excludedIds[0] === seeded.labManualId,
        `${excludedIds.length} excluded`,
      ),
      result(
        `the lecture notes' Chapter ${EXAM_TITLE} is the only old exam`,
        examIds.length === 1 && examIds[0] === seeded.examChapterId,
        `${examIds.length} old exams`,
      ),
      result(
        "an exam scope excludes the Chapter 2 Topic",
        scopes.data!.length === 1 &&
          scopes.data![0]!.scope === "excluded" &&
          scopes.data![0]!.topic_id === seeded.chapter2Topic,
        JSON.stringify(scopes.data),
      ),
      result(
        "Chapter 2's KCs read Priority 0",
        chapter2.every((value) => value === 0),
        JSON.stringify(chapter2),
      ),
      result("the scope is confirmed", b.scope_confirmed),
      result(
        "the notes mention determinants",
        b.notes?.toLowerCase().includes("determinants") ?? false,
        JSON.stringify(b.notes),
      ),
      ...reservation,
    ];
  },
};

/**
 * Completes intake directly: the scripted messages leave the formula sheet
 * unanswered, and a missed answer is reported above.
 */
async function completeIntake(supabase: AdminSupabase, courseId: string) {
  const done = await supabase
    .from("briefs")
    .update({
      exam_date: "2026-12-03",
      goal: "good_grade",
      open_book: false,
      formula_sheet: false,
      calculator: true,
      scope_confirmed: true,
    })
    .eq("course_id", courseId);
  if (done.error) throw new Error(done.error.message);
}

/**
 * With intake done and an old exam in the Course, the AI asks whether to
 * keep it aside for the final Mock exam; the Student keeps it.
 */
async function answerReservation(
  supabase: AdminSupabase,
  client: Supabase,
  studentId: string,
  courseId: string,
  examId: string,
) {
  const prompt = "What else do you need from me?";
  console.info(`Student: ${prompt}`);
  const asked = await send(client, studentId, courseId, prompt);
  console.info(`AI: ${asked}`);
  const answer = `Keep ${EXAM_TITLE} aside for my final mock exam.`;
  console.info(`Student: ${answer}`);
  console.info(`AI: ${await send(client, studentId, courseId, answer)}`);

  const stored = await supabase
    .from("briefs")
    .select("reserved_exam_chapter_id, reserved_exam_answered")
    .eq("course_id", courseId)
    .single();
  if (stored.error) throw new Error(stored.error.message);
  return [
    result(
      "the AI asks about keeping the old exam",
      asked.includes(EXAM_TITLE),
      JSON.stringify(asked),
    ),
    result(
      "the reserved exam is stored",
      stored.data.reserved_exam_answered &&
        stored.data.reserved_exam_chapter_id === examId,
      JSON.stringify(stored.data),
    ),
  ];
}
