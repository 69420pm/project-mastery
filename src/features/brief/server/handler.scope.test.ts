// @vitest-environment node
// The Brief's scope step: old exams, exam scopes and the admin texts.
// Shared setup and helpers: handler-testing.ts.
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import type { Supabase } from "@/lib/supabase/types";
import {
  BIG_IDEA,
  COURSE,
  OLD_EXAM,
  STUDENT,
  adminChunk,
  db,
  send,
  stored,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

/** A Brief whose intake is done, or lacks one answer. */
function seedBrief({ done }: { done: boolean }) {
  db.tables.briefs.push({
    course_id: COURSE,
    owner: STUDENT,
    exam_date: "2026-12-03",
    goal: "pass",
    hours_per_week: 5,
    question_style: "written",
    open_book: false,
    formula_sheet: false,
    calculator: done ? true : null,
    scope_confirmed: true,
    notes: null,
  });
}

/** Opens the Brief as its page does. */
async function open() {
  const { openBrief } = await import("./brief-store");
  return openBrief(db as unknown as Supabase, COURSE);
}

describe("the old-exam question", () => {
  test("is not posted before intake is done", async () => {
    seedBrief({ done: false });
    await open();
    expect(stored()).toHaveLength(1);
  });

  test("asks once about the parsed Materials not asked yet, naming the likely ones", async () => {
    seedBrief({ done: true });

    await open();
    await open();

    expect(stored().slice(1)).toEqual([
      {
        role: "assistant",
        text: "Are any of these old exams? Old exam 2024, Lecture 1\n\nOld exam 2024 looks like an old exam by its name.",
      },
    ]);
  });

  test("the answer marks them asked, and a Material parsed later is asked alone", async () => {
    seedBrief({ done: true });
    await open();
    useMockModels({
      brief: mockToolModel(
        [[{ toolName: "saveBrief", input: { examMaterialIds: [OLD_EXAM] } }]],
        "Noted.",
      ),
    });
    await send({ courseId: COURSE, message: userMessage("The first one.") });

    expect(
      db.tables.materials.map(({ is_exam, exam_asked }) => [
        is_exam,
        exam_asked,
      ]),
    ).toEqual([
      [true, true],
      [false, true],
    ]);
    db.tables.materials.push({
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      owner: STUDENT,
      course_id: COURSE,
      name: "Sheet 3",
      created_at: "2026-10-03T00:00:00Z",
      parse_status: "parsed",
      is_exam: null,
      exam_asked: false,
    });
    await open();

    expect(stored().at(-1)?.text).toBe("Are any of these old exams? Sheet 3");
  });
});

describe("setExamScope", () => {
  const scopeCall = (words: string) =>
    mockToolModel(
      [
        [
          {
            toolName: "setExamScope",
            input: { bigIdeaId: BIG_IDEA, scope: "excluded", words },
          },
        ],
      ],
      "Ok.",
    );

  test("is refused until the Student confirms in their own words", async () => {
    seedBrief({ done: true });
    const proposed = scopeCall("Integrals are not examined");
    useMockModels({ brief: proposed });

    await send({ courseId: COURSE, message: userMessage("What else?") });

    expect(db.tables.exam_scopes).toEqual([]);
    expect(JSON.stringify(proposed.doStreamCalls.at(-1)!.prompt)).toContain(
      "Ask the Student to confirm it in their own words first",
    );

    useMockModels({ brief: scopeCall("integrals are NOT examined") });
    await send({
      courseId: COURSE,
      message: userMessage("Yes, integrals are not examined this year."),
    });

    expect(db.tables.exam_scopes).toEqual([
      expect.objectContaining({
        big_idea_id: BIG_IDEA,
        topic_id: null,
        scope: "excluded",
        words: "integrals are NOT examined",
      }),
    ]);
  });

  test("refuses a Big idea of another Course", async () => {
    seedBrief({ done: true });
    const model = mockToolModel(
      [
        [
          {
            toolName: "setExamScope",
            input: { bigIdeaId: "nope", scope: null },
          },
        ],
      ],
      "Ok.",
    );
    useMockModels({ brief: model });

    await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt)).toContain(
      "nope is no Big idea or Topic of the Course",
    );
  });
});

test("the context lists each admin text once, with where it first appears", async () => {
  seedBrief({ done: true });
  db.tables.chunks.push(
    adminChunk(3, "Chapter 2 is not examined.  Page 3"),
    adminChunk(4, "Chapter 2 is not\nexamined. Page 4"),
    adminChunk(5, "Bring a calculator."),
  );
  const model = mockTextModel("Ok.");
  useMockModels({ brief: model });

  await send({ courseId: COURSE, message: userMessage("Hi") });

  const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
  expect(prompt.match(/Chapter 2 is not/g)).toHaveLength(1);
  expect(prompt).toContain("Lecture 1 p. 3");
  expect(prompt).toContain("Lecture 1 p. 5");
  expect(prompt).toContain(`Big idea \\"Integrals\\" (id ${BIG_IDEA})`);
});
