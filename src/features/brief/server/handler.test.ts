// @vitest-environment node
import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { mockTextModel, useMockModels } from "@/lib/ai/testing";
import { fakeSupabase, type FakeRow } from "@/lib/supabase/testing";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const STUDENT = "11111111-1111-1111-1111-111111111111";
const CLASSMATE = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const CLASSMATE_COURSE = "bbbbbbbb-c000-4000-8000-000000000001";

let signedIn: string | null = STUDENT;
let db = createDb();

/** The local tables, with the ownership rules of the real policies. */
function createDb() {
  return fakeSupabase({
    tables: {
      courses: [
        { id: COURSE, owner: STUDENT, name: "Calculus" },
        { id: CLASSMATE_COURSE, owner: CLASSMATE, name: "Biology" },
      ] as FakeRow[],
      briefs: [],
      brief_messages: [],
      ai_usage: [],
    },
    defaults: {
      briefs: () => ({ owner: signedIn }),
      brief_messages: () => ({ owner: signedIn, model_id: null }),
      ai_usage: () => ({
        owner: signedIn,
        estimated: false,
        chat_id: null,
        created_at: new Date().toISOString(),
      }),
    },
    canAccess: (table, row, tables) =>
      row.owner === signedIn &&
      (table === "briefs"
        ? tables.courses.some(
            (course) =>
              course.id === row.course_id && course.owner === signedIn,
          )
        : table !== "brief_messages" ||
          tables.briefs.some(
            (brief) =>
              brief.course_id === row.course_id && brief.owner === signedIn,
          )),
  });
}

vi.mock("@/lib/auth/user", () => ({
  getUser: async () => (signedIn ? { id: signedIn, email: undefined } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

beforeEach(() => {
  signedIn = STUDENT;
  db = createDb();
  vi.stubEnv("AI_DAILY_LIMIT_USD", "");
});

function userMessage(text: string, id: string = randomUUID()) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** Posts a request to the Brief handler and reads the whole response. */
async function send(body: unknown) {
  const { handleBriefRequest } = await import("./handler");
  const response = await handleBriefRequest(
    new Request("http://localhost/api/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const raw = await response.text();
  if (!response.ok) return { status: response.status, refusal: raw };
  const text = raw
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)))
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
  return { status: response.status, text };
}

/** The stored messages of a Course's Brief as role and text, in order. */
function stored(courseId = COURSE) {
  return db.tables.brief_messages
    .filter((message) => message.course_id === courseId)
    .map((message) => ({
      role: message.role,
      text: (message.parts as Array<{ text?: string }>)
        .map((part) => part.text ?? "")
        .join(""),
    }));
}

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

describe("refusals", () => {
  test("a signed-out visitor is refused", async () => {
    signedIn = null;
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
