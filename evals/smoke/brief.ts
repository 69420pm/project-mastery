import { randomUUID } from "node:crypto";
import { respondInBrief } from "@/features/brief/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";
import { insertRows } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/** The lecture notes' last Chapter, which the parse proposed as an old exam. */
const EXAM_TITLE = "Klausur 2025";

/** What the Student tells the AI, one message per reply. */
const MESSAGES = [
  "Exam is 2026-12-03, closed book, calculator allowed, written. I want a good grade and have 6 hours a week.",
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

/** The seeded Course: its Materials and the Topic the exam leaves out. */
type Seeded = {
  courseId: string;
  labManualId: string;
  /** The old exam Chapter inside the lecture notes. */
  examChapterId: string;
  /** The KCs of Chapter 2, which an admin text says is not examined. */
  chapter2Kcs: string[];
  /** The Topic that holds them. */
  chapter2Topic: string;
};

/**
 * A small Course seeded in code (#229): a lab manual and lecture notes
 * whose admin chunk says "Chapter 2 is not examined", with Chapters 1 and
 * 2 and a last Chapter "Klausur 2025" that the parse proposed as an old
 * exam, and a map of two top-level Topics, one per teaching Chapter.
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
  const [labManualId, notesId] = [randomUUID(), randomUUID()];
  await insertRows(
    supabase,
    "materials",
    [
      [labManualId, "Lab manual"],
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
  // The lab manual's root Chapter, and the lecture notes' root Chapter with
  // its three Chapters, each titled as printed.
  const [labRoot, notesRoot, chapter1, chapter2, examChapter] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const chapter = (
    id: string,
    materialId: string,
    parentId: string | null,
    position: number,
    title: string,
  ) => ({
    ...owned,
    id,
    material_id: materialId,
    parent_id: parentId,
    position,
    depth: parentId === null ? 0 : 1,
    title,
    page_from: Math.max(position, 1),
    exam_proposed: title === EXAM_TITLE,
  });
  await insertRows(supabase, "chapters", [
    chapter(labRoot, labManualId, null, 0, "Lab manual"),
    chapter(notesRoot, notesId, null, 0, "Lecture notes"),
    chapter(chapter1, notesId, notesRoot, 1, "Chapter 1: Vectors"),
    chapter(chapter2, notesId, notesRoot, 2, "Chapter 2: Matrices"),
    chapter(examChapter, notesId, notesRoot, 3, EXAM_TITLE),
  ]);
  const chunk = (
    page: number,
    chapterId: string,
    label: string,
    markdown: string,
  ) => ({
    ...owned,
    id: randomUUID(),
    material_id: notesId,
    chapter_id: chapterId,
    position: page - 1,
    page_from: page,
    page_to: page,
    label,
    markdown,
  });
  const chunks = [
    chunk(1, notesRoot, "admin", "Chapter 2 is not examined."),
    chunk(2, chapter1, "content", "# Chapter 1: Vectors\nA vector is ..."),
    chunk(3, chapter2, "content", "# Chapter 2: Matrices\nA matrix is ..."),
    chunk(
      4,
      examChapter,
      "exercise",
      `# ${EXAM_TITLE}\n**Problem 1.** Add the vectors (1, 2) and (3, 4).`,
    ),
  ];
  await insertRows(supabase, "chunks", chunks);

  // Two top-level Topics, each holding one Chapter's KC.
  const [vectors, matrices] = [randomUUID(), randomUUID()];
  const topic = (
    id: string,
    name: string,
    chapterId: string,
    position: number,
  ) => ({
    ...owned,
    id,
    name,
    central_question: `What is ${name}?`,
    chapter_ids: [chapterId],
    position,
  });
  await insertRows(supabase, "topics", [
    topic(vectors, "Chapter 1: Vectors", chapter1, 0),
    topic(matrices, "Chapter 2: Matrices", chapter2, 1),
  ]);
  const kc = (name: string, position: number) => ({
    ...owned,
    id: randomUUID(),
    name,
    description: `${name}.`,
    origin: "content",
    position,
  });
  const kcs = [kc("Vector addition", 0), kc("Matrix product", 1)];
  await insertRows(supabase, "kcs", kcs);
  await insertRows(
    supabase,
    "topic_kcs",
    [vectors, matrices].map((topicId, index) => ({
      topic_id: topicId,
      kc_id: kcs[index]!.id,
      owner: studentId,
      position: 0,
    })),
  );
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
    examChapterId: examChapter,
    chapter2Kcs: [kcs[1]!.id],
    chapter2Topic: matrices,
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
