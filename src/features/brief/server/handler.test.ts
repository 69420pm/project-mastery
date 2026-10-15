// @vitest-environment node
// The Brief handler: replies, the intake tools, refusals and the Daily limit.
// Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  CLASSMATE_COURSE,
  COURSE,
  LECTURE,
  OLD_EXAM,
  STUDENT,
  db,
  send,
  signInAs,
  stored,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));
describe("a message in a Brief", () => {
  test("creates the Brief with its opening message, stores the message and the reply", async () => {
    useMockModels({ brief: mockTextModel("Which date is the exam?") });

    const reply = await send({
      courseId: COURSE,
      message: userMessage("It is hard."),
    });

    expect(reply).toEqual({ status: 200, text: "Which date is the exam?" });
    expect(db.tables.briefs).toEqual([
      expect.objectContaining({ course_id: COURSE, owner: STUDENT }),
    ]);
    expect(stored()).toEqual([
      { role: "assistant", text: expect.stringContaining("When is it?") },
      { role: "user", text: "It is hard." },
      { role: "assistant", text: "Which date is the exam?" },
    ]);
    expect(db.tables.brief_messages.at(-1)).toMatchObject({
      model_id: "xiaomi/mimo-v2.6-flash",
    });
  });

  test("sends the stored history to the model", async () => {
    const model = mockTextModel("Noted.");
    useMockModels({ brief: model });

    await send({ courseId: COURSE, message: userMessage("First") });
    await send({ courseId: COURSE, message: userMessage("Second") });

    const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain("When is it?");
    expect(prompt).toContain("First");
    expect(prompt).toContain("Noted.");
    expect(prompt).toContain("Second");
  });

  test("records usage under the brief task", async () => {
    useMockModels({ brief: mockTextModel("Ok.") });

    await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({
        owner: STUDENT,
        task: "brief",
        model_id: "xiaomi/mimo-v2.6-flash",
        input_tokens: 10,
        output_tokens: 20,
        estimated: false,
      }),
    ]);
  });

  test("a failed reply records an estimated cost and stores no reply", async () => {
    useMockModels({
      brief: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("Model unavailable");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ task: "brief", estimated: true }),
    ]);
    expect(stored().map(({ role }) => role)).toEqual(["assistant", "user"]);
  });

  test("answers a stored last message again when retrying", async () => {
    useMockModels({ brief: mockTextModel("Second try.") });
    const message = userMessage("Hi");
    db.tables.briefs.push({ course_id: COURSE, owner: STUDENT });
    db.tables.brief_messages.push({
      id: message.id,
      course_id: COURSE,
      owner: STUDENT,
      role: "user",
      parts: message.parts,
      model_id: null,
    });

    const reply = await send({ courseId: COURSE, message });

    expect(reply.text).toBe("Second try.");
    expect(stored().map(({ text }) => text)).toContain("Second try.");
    expect(stored().filter(({ role }) => role === "user")).toHaveLength(1);
  });

  test("refuses a message id that was already answered", async () => {
    useMockModels({ brief: mockTextModel("Ok.") });
    const message = userMessage("Hi");
    await send({ courseId: COURSE, message });

    const again = await send({
      courseId: COURSE,
      message: userMessage("Later"),
    });
    const stale = await send({ courseId: COURSE, message });

    expect(again.status).toBe(200);
    expect(stale.status).toBe(409);
  });
});

describe("the tools", () => {
  test("store the answers, the excluded Materials and the notes", async () => {
    useMockModels({
      brief: mockToolModel(
        [
          [
            {
              toolName: "saveBrief",
              input: {
                examDate: "2026-12-03",
                goal: "good_grade",
                hoursPerWeek: 6,
                questionStyle: "written",
                openBook: false,
                formulaSheet: null,
                calculator: true,
                excludedMaterialIds: [OLD_EXAM, "not-a-material"],
                scopeConfirmed: true,
              },
            },
            { toolName: "addNote", input: { text: "Heat exchangers!" } },
          ],
        ],
        "Got it.",
      ),
    });

    const reply = await send({ courseId: COURSE, message: userMessage("…") });

    expect(reply).toEqual({ status: 200, text: "Got it." });
    expect(db.tables.briefs[0]).toMatchObject({
      exam_date: "2026-12-03",
      goal: "good_grade",
      hours_per_week: 6,
      question_style: "written",
      open_book: false,
      formula_sheet: null,
      calculator: true,
      scope_confirmed: true,
      notes: "Heat exchangers!",
    });
    expect(db.tables.brief_excluded_materials).toEqual([
      expect.objectContaining({ course_id: COURSE, material_id: OLD_EXAM }),
    ]);
    // One row for the reply, over both steps.
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ task: "brief", input_tokens: 20 }),
    ]);
  });

  test("append notes after a blank line, and replace the excluded set", async () => {
    const note = (text: string) => ({ toolName: "addNote", input: { text } });
    const exclude = (ids: string[]) => ({
      toolName: "saveBrief",
      input: { excludedMaterialIds: ids },
    });
    useMockModels({
      brief: mockToolModel(
        [
          [note("First."), exclude([OLD_EXAM])],
          [note("Second.")],
          [exclude([LECTURE])],
        ],
        "Ok.",
      ),
    });

    await send({ courseId: COURSE, message: userMessage("…") });

    expect(db.tables.briefs[0]?.notes).toBe("First.\n\nSecond.");
    expect(
      db.tables.brief_excluded_materials.map((row) => row.material_id),
    ).toEqual([LECTURE]);
  });

  test("a reply that only saved answers is stored", async () => {
    useMockModels({
      brief: mockToolModel(
        [[{ toolName: "addNote", input: { text: "Bring a ruler." } }]],
        "",
      ),
    });

    await send({ courseId: COURSE, message: userMessage("Bring a ruler.") });

    expect(stored().map(({ role }) => role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
  });

  test("a malformed call changes nothing and tells the model why", async () => {
    const model = mockToolModel(
      [[{ toolName: "saveBrief", input: { hoursPerWeek: 100 } }]],
      "How many hours?",
    );
    useMockModels({ brief: model });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const reply = await send({ courseId: COURSE, message: userMessage("…") });

    expect(reply.text).toBe("How many hours?");
    expect(db.tables.briefs[0]?.hours_per_week).toBeNull();
    const retry = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(retry).toContain("hoursPerWeek");
  });

  test("the instructions hold the stored answers and the Course's Materials", async () => {
    const model = mockTextModel("Ok.");
    useMockModels({ brief: model });
    db.tables.briefs.push({
      course_id: COURSE,
      owner: STUDENT,
      exam_date: "2026-12-03",
      goal: null,
      scope_confirmed: false,
      notes: null,
    });
    db.tables.brief_excluded_materials.push({
      course_id: COURSE,
      material_id: OLD_EXAM,
      owner: STUDENT,
    });

    await send({ courseId: COURSE, message: userMessage("Hi") });

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
    expect(prompt).toContain("exam date: 2026-12-03");
    expect(prompt).toContain("goal: not answered");
    expect(prompt).toContain(`\\"Old exam 2024\\" (id ${OLD_EXAM}): excluded`);
    expect(prompt).toContain(`\\"Lecture 1\\" (id ${LECTURE})`);
  });
});

describe("refusals", () => {
  test("a signed-out visitor is refused", async () => {
    signInAs(null);
    expect(
      (await send({ courseId: COURSE, message: userMessage("Hi") })).status,
    ).toBe(401);
  });

  test("an invalid request is refused", async () => {
    expect((await send({ courseId: "nope" })).status).toBe(400);
    const empty = await send({ courseId: COURSE, message: userMessage("  ") });
    expect(empty).toEqual({ status: 400, refusal: "Your message is empty." });
  });

  test("another Student's Course is not found, and nothing is stored", async () => {
    const model = mockTextModel("Never sent.");
    useMockModels({ brief: model });

    const reply = await send({
      courseId: CLASSMATE_COURSE,
      message: userMessage("Hi"),
    });

    expect(reply.status).toBe(404);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(db.tables.brief_messages).toEqual([]);
  });
});

describe("the Daily limit", () => {
  test("once reached, refuses the message before any model call or new Brief", async () => {
    vi.stubEnv("AI_DAILY_LIMIT_USD", "1");
    db.tables.ai_usage.push({
      id: randomUUID(),
      owner: STUDENT,
      task: "chat",
      model_id: "xiaomi/mimo-v2.6-flash",
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      cost_usd: 1,
      estimated: false,
      chat_id: null,
      created_at: new Date().toISOString(),
    });
    const model = mockTextModel("Never sent.");
    useMockModels({ brief: model });

    const reply = await send({ courseId: COURSE, message: userMessage("Hi") });

    expect(reply).toEqual({
      status: 429,
      refusal:
        "You've reached today's daily limit. The AI is available again after it resets.",
    });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(db.tables.briefs).toEqual([]);
  });
});
