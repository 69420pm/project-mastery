// @vitest-environment node
// The Brief's review queue: asking open Findings and storing the answers.
// Shared setup and helpers: handler-testing.ts.
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import type { Supabase } from "@/lib/supabase/types";
import {
  CLASSMATE_FINDING,
  COURSE,
  MISMATCH,
  SCOPE,
  STUDENT,
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

const askedAt = (id: string) =>
  db.tables.findings.find((row) => row.id === id)?.asked_at;

/** Opens the Brief as its page does. */
async function open() {
  const { openBrief } = await import("./brief-store");
  return openBrief(db as unknown as Supabase, COURSE);
}

/** A model that calls answerFinding once, then replies `text`. */
function answering(findingId: string, answer: string, text = "Ok.") {
  return mockToolModel(
    [[{ toolName: "answerFinding", input: { findingId, answer } }]],
    text,
  );
}

describe("the review queue", () => {
  test("asks no Finding before intake is done", async () => {
    seedBrief({ done: false });
    const model = mockTextModel("Calculator?");
    useMockModels({ brief: model });

    await open();
    await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(stored().map(({ text }) => text)).not.toContainEqual(
      expect.stringContaining("Finding"),
    );
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain(
      "Finding 0",
    );
    expect(askedAt(MISMATCH)).toBeNull();
  });

  test("opening the Brief posts the first open Finding once and marks it asked", async () => {
    seedBrief({ done: true });

    await open();
    await open();

    expect(stored().slice(1)).toEqual([
      {
        role: "assistant",
        text: "Finding 0 of solution_mismatch. Which is right?\n\nSources: Lecture 1 p. 3",
      },
    ]);
    expect(db.tables.brief_messages.at(-1)).toMatchObject({
      model_id: "static",
    });
    expect(askedAt(MISMATCH)).not.toBeNull();
    expect(askedAt(SCOPE)).toBeNull();
  });

  test("opening posts nothing while an asked Finding waits for its answer", async () => {
    seedBrief({ done: true });
    const scope = db.tables.findings.find((row) => row.id === SCOPE)!;
    scope.asked_at = "2026-10-01T00:00:00Z";

    await open();

    expect(stored()).toHaveLength(1);
    expect(askedAt(MISMATCH)).toBeNull();
  });

  test("opening while a parallel open already posted the Finding does not throw", async () => {
    seedBrief({ done: true });
    await open();
    // The other open stored the message but has not marked the Finding yet.
    db.tables.findings[0]!.asked_at = null;

    await expect(open()).resolves.not.toBeNull();

    expect(stored()).toHaveLength(2);
    expect(askedAt(MISMATCH)).not.toBeNull();
  });

  test("answerFinding stores the answer verbatim and the next Finding is asked", async () => {
    seedBrief({ done: true });
    await open();
    const model = answering(MISMATCH, "50.8% is right");
    useMockModels({ brief: model });

    await send({ courseId: COURSE, message: userMessage("50.8% is right") });

    expect(db.tables.findings[0]).toMatchObject({
      status: "answered",
      answer: "50.8% is right",
      answered_at: expect.any(String),
    });
    expect(askedAt(SCOPE)).not.toBeNull();
    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
    expect(prompt).toContain(`asking now (id ${MISMATCH})`);
    expect(prompt).toContain(`next question (id ${SCOPE})`);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain(
      `next question about the materials (id ${SCOPE})`,
    );
  });

  test("a Finding counts as asked only once a reply asking it is stored", async () => {
    seedBrief({ done: true });
    useMockModels({
      brief: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await send({ courseId: COURSE, message: userMessage("Hi") });
    expect(askedAt(MISMATCH)).toBeNull();

    useMockModels({ brief: mockTextModel("Which is right?") });
    await send({ courseId: COURSE, message: userMessage("Hi") });
    expect(askedAt(MISMATCH)).not.toBeNull();
  });

  test("answerFinding keeps an answer already stored", async () => {
    seedBrief({ done: true });
    await open();
    useMockModels({ brief: answering(MISMATCH, "50.8% is right") });
    await send({ courseId: COURSE, message: userMessage("50.8% is right") });
    const model = answering(MISMATCH, "Actually no");
    useMockModels({ brief: model });

    await send({ courseId: COURSE, message: userMessage("Actually no") });

    expect(db.tables.findings[0]).toMatchObject({ answer: "50.8% is right" });
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain(
      "Not saved",
    );
  });

  test("answerFinding refuses a Finding that is not the Course's", async () => {
    seedBrief({ done: true });
    const model = answering(CLASSMATE_FINDING, "Skip it");
    useMockModels({ brief: model });

    await send({ courseId: COURSE, message: userMessage("Skip it") });

    expect(
      db.tables.findings.find((row) => row.id === CLASSMATE_FINDING),
    ).toMatchObject({ status: "open", answer: null });
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain(
      "Not saved",
    );
  });
});
