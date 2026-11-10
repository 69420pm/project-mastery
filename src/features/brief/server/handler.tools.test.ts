// @vitest-environment node
// The Brief handler: what each tool result tells the model on the next step.
// Shared setup and helpers: handler-testing.ts.
import { describe, expect, test, vi } from "vitest";
import { mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  LECTURE_EXAM,
  LECTURE_ROOT,
  OLD_EXAM,
  OLD_EXAM_ROOT,
  STUDENT,
  db,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const examChapter = (id: string) =>
  db.tables.chapters.find((chapter) => chapter.id === id)!;

function seedBrief(notes: string | null = null) {
  db.tables.briefs.push({
    course_id: COURSE,
    owner: STUDENT,
    exam_date: "2026-12-03",
    goal: "pass",
    open_book: false,
    formula_sheet: false,
    calculator: true,
    scope_confirmed: true,
    notes,
  });
}

/** A model that makes one tool call, then replies "Ok.". */
const toolModel = (toolName: string, input: Record<string, unknown>) =>
  mockToolModel([[{ toolName, input }]], "Ok.");

/** Sends a message to `model` and returns the prompt of its last step. */
async function lastPrompt(model: ReturnType<typeof toolModel>) {
  await send({ courseId: COURSE, message: userMessage("…") });
  return JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
}

describe("a tool result", () => {
  test("saveBrief names the ids it ignored", async () => {
    const model = toolModel("saveBrief", {
      excludedMaterialIds: [OLD_EXAM, "not-a-material"],
    });
    useMockModels({ brief: model });

    const prompt = await lastPrompt(model);

    expect(prompt).toContain(
      "These are no Material ids of the Course and were ignored: not-a-material.",
    );
  });

  test("saveBrief stores the reserved exam, or none, and ignores a Chapter that is no old exam", async () => {
    seedBrief();
    // The old exam inside Lecture 1.
    examChapter(LECTURE_EXAM).is_exam = true;

    useMockModels({
      brief: toolModel("saveBrief", { reservedExamChapterId: LECTURE_EXAM }),
    });
    await send({ courseId: COURSE, message: userMessage("…") });
    expect(db.tables.briefs[0]).toMatchObject({
      reserved_exam_chapter_id: LECTURE_EXAM,
      reserved_exam_answered: true,
    });

    const lecture = toolModel("saveBrief", {
      reservedExamChapterId: LECTURE_ROOT,
    });
    useMockModels({ brief: lecture });
    expect(await lastPrompt(lecture)).toContain(
      `${LECTURE_ROOT} is no old exam of the Course and was ignored`,
    );
    expect(db.tables.briefs[0]?.reserved_exam_chapter_id).toBe(LECTURE_EXAM);

    useMockModels({
      brief: toolModel("saveBrief", { reservedExamChapterId: "none" }),
    });
    await send({ courseId: COURSE, message: userMessage("…") });
    expect(db.tables.briefs[0]).toMatchObject({
      reserved_exam_chapter_id: null,
      reserved_exam_answered: true,
    });
  });

  test("saveBrief keeps a reserved exam that a submitted mock used", async () => {
    seedBrief();
    examChapter(OLD_EXAM_ROOT).is_exam = true;
    Object.assign(db.tables.briefs[0]!, {
      reserved_exam_chapter_id: OLD_EXAM_ROOT,
      reserved_exam_answered: true,
    });
    db.tables.mock_exams.push({
      id: "dddddddd-0000-4000-8000-000000000001",
      owner: STUDENT,
      course_id: COURSE,
      reserved_chapter_id: OLD_EXAM_ROOT,
      status: "submitted",
    });

    const model = toolModel("saveBrief", { reservedExamChapterId: "none" });
    useMockModels({ brief: model });

    expect(await lastPrompt(model)).toContain("it can no longer change");
    expect(db.tables.briefs[0]?.reserved_exam_chapter_id).toBe(OLD_EXAM_ROOT);
  });

  test("saveBrief stores the Course language the Student asked for", async () => {
    seedBrief();
    useMockModels({
      brief: toolModel("saveBrief", { courseLanguage: "German" }),
    });

    await send({ courseId: COURSE, message: userMessage("Auf Deutsch!") });

    expect(db.tables.courses[0]?.language).toBe("German");
  });

  test("saveBrief reserves a proposed exam the same call leaves out of the old exams, and reads a quoted none as none", async () => {
    seedBrief();
    useMockModels({
      brief: toolModel("saveBrief", {
        examChapterIds: [OLD_EXAM_ROOT],
        reservedExamChapterId: LECTURE_EXAM,
      }),
    });
    await send({ courseId: COURSE, message: userMessage("…") });
    expect(db.tables.briefs[0]).toMatchObject({
      reserved_exam_chapter_id: LECTURE_EXAM,
      reserved_exam_answered: true,
    });
    expect(examChapter(OLD_EXAM_ROOT).is_exam).toBe(true);
    expect(examChapter(LECTURE_EXAM).is_exam).toBe(true);

    useMockModels({
      brief: toolModel("saveBrief", { reservedExamChapterId: '"none"' }),
    });
    await send({ courseId: COURSE, message: userMessage("…") });
    expect(db.tables.briefs[0]?.reserved_exam_chapter_id).toBeNull();
    expect(examChapter(LECTURE_EXAM).is_exam).toBe(true);
  });

  test("saveBrief keeps the scope step answered", async () => {
    seedBrief();
    const model = toolModel("saveBrief", { scopeConfirmed: false });
    useMockModels({ brief: model });

    expect(await lastPrompt(model)).toContain(
      "scopeConfirmed false was ignored",
    );
    expect(db.tables.briefs[0]?.scope_confirmed).toBe(true);
  });

  test("a reply that loops on tools stores each answer once and still answers", async () => {
    seedBrief("Exam is closed book, no formula sheet, no calculator allowed.");
    const format = { openBook: false, formulaSheet: false, calculator: false };
    const model = mockToolModel(
      [
        [
          { toolName: "saveBrief", input: format },
          { toolName: "saveBrief", input: format },
          { toolName: "saveBrief", input: { goal: "pass" } },
          { toolName: "saveBrief", input: { examDate: "2026-12-04" } },
          { toolName: "saveBrief", input: { goal: "good_grade" } },
          {
            toolName: "addNote",
            input: { text: "Closed book exam; no calculator permitted." },
          },
          {
            toolName: "addNote",
            input: { text: "The teacher stresses proofs by induction." },
          },
          {
            toolName: "addNote",
            input: { text: "Teacher stresses induction proofs." },
          },
        ],
      ],
      "Ok.",
    );
    useMockModels({ brief: model });

    const reply = await send({ courseId: COURSE, message: userMessage("…") });

    expect(reply.text).toBe("Ok.");
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain("this reply already made this call");
    expect(prompt).toContain("this reply has called saveBrief too often");
    expect(prompt).toContain(
      "saveBrief already stores whether the exam is open book",
    );
    expect(prompt).toContain("the notes already say this");
    expect(db.tables.briefs[0]).toMatchObject({
      goal: "pass",
      exam_date: "2026-12-04",
      notes:
        "Exam is closed book, no formula sheet, no calculator allowed.\n\nThe teacher stresses proofs by induction.",
    });
  });

  test("addNote over the notes' limit changes nothing and says so", async () => {
    const full = "x".repeat(19_990);
    seedBrief(full);

    const model = toolModel("addNote", { text: "Heat exchangers!" });
    useMockModels({ brief: model });

    const prompt = await lastPrompt(model);

    expect(prompt).toContain("Not saved: the notes are full. Nothing changed.");
    expect(db.tables.briefs[0]?.notes).toBe(full);
  });
});
