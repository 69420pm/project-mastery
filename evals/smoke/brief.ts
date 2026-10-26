import { randomUUID } from "node:crypto";
import { openBrief, respondInBrief } from "@/features/brief/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";
import { result, type SmokeCheck } from "./smoke-check";

/** What the Student tells the AI, one message per reply. */
const MESSAGES = [
  "Exam is 2026-12-03, closed book, calculator allowed, written. I want a good grade and have 6 hours a week.",
  "Skip the lab manual. The lecturer said heat exchangers are important.",
];

/** Sends one message through the Brief handler and returns the reply's text. */
async function send(
  client: Supabase,
  studentId: string,
  courseId: string,
  text: string,
) {
  const response = await respondInBrief({
    request: new Request("http://localhost/api/brief", {
      method: "POST",
      body: JSON.stringify({
        courseId,
        message: {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      }),
    }),
    supabase: client,
    userId: studentId,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  const chunks = body
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  for (const chunk of chunks) {
    if (chunk.type === "tool-input-available") {
      console.info(`  ${chunk.toolName} ${JSON.stringify(chunk.input)}`);
    }
    if (chunk.type === "tool-output-error" || chunk.type === "error") {
      console.info(`  ${chunk.type}: ${chunk.errorText}`);
    }
  }
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
}

/**
 * Tells the AI about an exam in a new Course's Brief, in two scripted
 * messages through the real handler, and checks what the tools stored. Then
 * answers the reservation question on a seeded old exam and a seeded open
 * Finding, and checks both stored answers.
 */
export const briefSmoke: SmokeCheck = {
  name: "brief",
  usage:
    "pnpm smoke brief (two scripted messages in a Course's Brief, then the reserved exam and a seeded Finding)",
  // One recorded call per reply (5), with slack for retries.
  maxCalls: 7,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // The gold course has no old exam, so one is seeded for the reservation
    // question, beside the file the Student excludes.
    const materialId = randomUUID();
    const examId = randomUUID();
    const file = (id: string, name: string) => ({
      id,
      owner: studentId,
      course_id: course.id,
      name,
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${studentId}/${course.id}/${id}`,
    });
    const material = await supabase.from("materials").insert([
      file(materialId, "Lab manual"),
      {
        ...file(examId, "Exam 2025"),
        is_exam: true,
        exam_year: 2025,
        exam_total_points: 90,
      },
    ]);
    if (material.error) throw new Error(material.error.message);

    // The Brief runs as the Student, with Row Level Security as in the app.
    const client = await signInAsUser(supabase, studentId);
    for (const text of MESSAGES) {
      console.info(`Student: ${text}`);
      console.info(`AI: ${await send(client, studentId, course.id, text)}`);
    }

    const [brief, excluded] = await Promise.all([
      supabase
        .from("briefs")
        .select(
          "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes",
        )
        .eq("course_id", course.id)
        .single(),
      supabase
        .from("brief_excluded_materials")
        .select("material_id")
        .eq("course_id", course.id),
    ]);
    if (brief.error) throw new Error(brief.error.message);
    if (excluded.error) throw new Error(excluded.error.message);
    const b = brief.data;
    const expected = {
      exam_date: "2026-12-03",
      goal: "good_grade",
      hours_per_week: 6,
      question_style: "written",
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
    const excludedIds = excluded.data.map((row) => row.material_id);
    await completeIntake(supabase, course.id);
    const reservation = await answerReservation(
      supabase,
      client,
      studentId,
      course.id,
      examId,
    );
    const review = await answerSeededFinding(
      supabase,
      client,
      studentId,
      course.id,
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
        excludedIds.length === 1 && excludedIds[0] === materialId,
        `${excludedIds.length} excluded`,
      ),
      result("the scope is confirmed", b.scope_confirmed),
      result(
        "the notes mention heat exchangers",
        b.notes?.toLowerCase().includes("heat exchangers") ?? false,
        JSON.stringify(b.notes),
      ),
      ...reservation,
      ...review,
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
      hours_per_week: 6,
      question_style: "written",
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
  const answer = "Keep Exam 2025 aside for my final mock exam.";
  console.info(`Student: ${answer}`);
  console.info(`AI: ${await send(client, studentId, courseId, answer)}`);

  const stored = await supabase
    .from("briefs")
    .select("reserved_exam_material_id, reserved_exam_answered")
    .eq("course_id", courseId)
    .single();
  if (stored.error) throw new Error(stored.error.message);
  return [
    result(
      "the AI asks about keeping the old exam",
      asked.includes("Exam 2025"),
      JSON.stringify(asked),
    ),
    result(
      "the reserved exam is stored",
      stored.data.reserved_exam_answered &&
        stored.data.reserved_exam_material_id === examId,
      JSON.stringify(stored.data),
    ),
  ];
}

const FINDING_TEXT =
  "Exercise 2 prints an efficiency of 48.2%, but its worked steps give 50.8%.";
const FINDING_ANSWER = "The printed answer is wrong, 50.8% is right";

/**
 * Seeds one open `solution_mismatch` Finding, opens the
 * Brief (a static message, no model call) and answers it in one message.
 */
async function answerSeededFinding(
  supabase: AdminSupabase,
  client: Supabase,
  studentId: string,
  courseId: string,
) {
  const { data: finding, error } = await supabase
    .from("findings")
    .insert({
      owner: studentId,
      course_id: courseId,
      kind: "solution_mismatch",
      position: 0,
      text: FINDING_TEXT,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const messages = await openBrief(client, courseId);
  const posted = (messages?.at(-1)?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  console.info(`AI (static): ${posted}`);
  console.info(`Student: ${FINDING_ANSWER}`);
  console.info(
    `AI: ${await send(client, studentId, courseId, FINDING_ANSWER)}`,
  );

  const stored = await supabase
    .from("findings")
    .select("status, answer, asked_at")
    .eq("id", finding.id)
    .single();
  if (stored.error) throw new Error(stored.error.message);
  return [
    result(
      "opening the Brief asks the Finding",
      posted.startsWith(FINDING_TEXT) && posted.includes("Which is right?"),
      JSON.stringify(posted),
    ),
    result(
      "the Finding is answered with the Student's words",
      stored.data.status === "answered" &&
        stored.data.answer === FINDING_ANSWER,
      `${stored.data.status}: ${JSON.stringify(stored.data.answer)}`,
    ),
  ];
}
