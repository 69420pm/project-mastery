import { randomUUID } from "node:crypto";
import { respondInBrief } from "@/features/brief/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";
import { insertRows } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/** What the Student tells the AI, one message per reply. */
const MESSAGES = [
  "Exam is 2026-12-03, closed book, calculator allowed, written. I want a good grade and have 6 hours a week.",
  "Skip the lab manual. The lecturer said determinants are important.",
  "Klausur 2025 is an old exam, the others are not.",
  "Yes, Chapter 2 is not examined, leave it out.",
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

/** The seeded Course: its Materials and the Big idea the exam leaves out. */
type Seeded = {
  courseId: string;
  labManualId: string;
  examId: string;
  /** The KCs of Chapter 2, which an admin text says is not examined. */
  chapter2Kcs: string[];
};

/**
 * A small Course seeded in code: a lab manual, an old exam named "Klausur
 * 2025" and lecture notes whose admin chunk says "Chapter 2 is not
 * examined", with a map of two Big ideas, one per chapter.
 */
async function seedCourse(
  supabase: AdminSupabase,
  studentId: string,
): Promise<Seeded> {
  const { data: course, error } = await supabase
    .from("courses")
    .insert({ owner: studentId, name: "Smoke check" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const courseId = course.id;
  const owned = { owner: studentId, course_id: courseId };
  const [labManualId, examId, notesId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await insertRows(
    supabase,
    "materials",
    [
      [labManualId, "Lab manual"],
      [examId, "Klausur 2025"],
      [notesId, "Lecture notes"],
    ].map(([id, name], index) => ({
      ...owned,
      id,
      name,
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${studentId}/${courseId}/${id}`,
      parse_status: "parsed",
      created_at: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(),
    })),
  );
  const chunk = (page: number, label: string, markdown: string) => ({
    ...owned,
    id: randomUUID(),
    material_id: notesId,
    position: page - 1,
    page_from: page,
    page_to: page,
    label,
    markdown,
  });
  const chunks = [
    chunk(1, "admin", "Chapter 2 is not examined."),
    chunk(2, "content", "# Chapter 1: Vectors\nA vector is ..."),
    chunk(3, "content", "# Chapter 2: Matrices\nA matrix is ..."),
  ];
  await insertRows(supabase, "chunks", chunks);

  const [vectors, matrices] = [randomUUID(), randomUUID()];
  await insertRows(supabase, "big_ideas", [
    {
      ...owned,
      id: vectors,
      name: "Chapter 1: Vectors",
      description: "Vectors.",
      position: 0,
    },
    {
      ...owned,
      id: matrices,
      name: "Chapter 2: Matrices",
      description: "Matrices.",
      position: 1,
    },
  ]);
  const kc = (bigIdea: string, name: string, position: number) => ({
    ...owned,
    id: randomUUID(),
    big_idea_id: bigIdea,
    name,
    description: `${name}.`,
    type: "concept",
    origin: "content",
    position,
  });
  const kcs = [
    kc(vectors, "Vector addition", 0),
    kc(matrices, "Matrix product", 1),
  ];
  await insertRows(supabase, "kcs", kcs);
  await insertRows(
    supabase,
    "kc_sources",
    kcs.map((row, index) => ({
      ...owned,
      kc_id: row.id,
      chunk_id: chunks[index + 1]!.id,
    })),
  );
  return {
    courseId,
    labManualId,
    examId,
    chapter2Kcs: [kcs[1]!.id],
  };
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
    const seeded = await seedCourse(supabase, studentId);
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
          "exam_date, goal, hours_per_week, question_style, open_book, formula_sheet, calculator, scope_confirmed, notes",
        )
        .eq("course_id", courseId)
        .single(),
      supabase
        .from("brief_excluded_materials")
        .select("material_id")
        .eq("course_id", courseId),
      supabase
        .from("materials")
        .select("id")
        .eq("course_id", courseId)
        .eq("is_exam", true),
      supabase
        .from("exam_scopes")
        .select("big_idea_id, topic_id, scope, words")
        .eq("course_id", courseId),
    ]);
    for (const response of [brief, excluded, exams, scopes]) {
      if (response.error) throw new Error(response.error.message);
    }
    const b = brief.data!;
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
      seeded.examId,
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
        "Klausur 2025 is the only old exam",
        examIds.length === 1 && examIds[0] === seeded.examId,
        `${examIds.length} old exams`,
      ),
      result(
        "an exam scope excludes a Big idea",
        scopes.data!.length === 1 &&
          scopes.data![0]!.scope === "excluded" &&
          scopes.data![0]!.big_idea_id !== null,
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
  const answer = "Keep Klausur 2025 aside for my final mock exam.";
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
      asked.includes("Klausur 2025"),
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
