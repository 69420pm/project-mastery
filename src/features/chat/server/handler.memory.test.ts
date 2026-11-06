// @vitest-environment node
// The chat handler's Memory (#107): the remember tool appends to it, and the
// instructions hold it. Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import { COURSE, STUDENT, db, send, userMessage } from "./handler-testing";

vi.mock("server-only", () => ({}));

const today = () => new Date().toISOString().slice(0, 10);

const sendMessage = (text: string) =>
  send({ chatId: randomUUID(), courseId: COURSE, message: userMessage(text) });

const remembering = (text: string) =>
  mockToolModel([[{ toolName: "remember", input: { text } }]], "Noted.");

const promptOf = (model: ReturnType<typeof mockTextModel>, call = 0) =>
  JSON.stringify(model.doStreamCalls[call]!.prompt);

describe("remember", () => {
  test("appends a dated line to the Course's Memory", async () => {
    db.tables.memories.push({
      course_id: COURSE,
      owner: STUDENT,
      text: "2026-10-01: Studies on trains.",
    });
    const model = remembering("Learns best with examples before formulas.");
    useMockModels({ chat: model });

    const reply = await sendMessage("I learn best with examples first.");

    expect(reply.text).toBe("Noted.");
    expect(db.tables.memories).toEqual([
      expect.objectContaining({
        course_id: COURSE,
        text: `2026-10-01: Studies on trains.\n${today()}: Learns best with examples before formulas.`,
      }),
    ]);
    expect(promptOf(model, 1)).toContain('"value":{"ok":true}');
  });

  test("tells the model a full Memory, and the reply continues", async () => {
    const full = "x".repeat(3990);
    db.tables.memories.push({ course_id: COURSE, owner: STUDENT, text: full });
    const model = remembering("Prefers short answers.");
    useMockModels({ chat: model });

    const reply = await sendMessage("Keep it short, please.");

    expect(reply.text).toBe("Noted.");
    expect(promptOf(model, 1)).toContain(
      "Memory is full: the Student can tidy it on the Brief page.",
    );
    expect(db.tables.memories[0]!.text).toBe(full);
  });
});

describe("the instructions", () => {
  test("hold the Memory under its heading", async () => {
    db.tables.memories.push({
      course_id: COURSE,
      owner: STUDENT,
      text: "2026-10-01: Prefers worked examples.",
    });
    const model = mockTextModel("Hello!");
    useMockModels({ chat: model });

    await sendMessage("Hi");

    expect(promptOf(model)).toContain(
      "What you know about this Student from earlier Chats:\\n\\n2026-10-01: Prefers worked examples.",
    );
  });

  test("leave the heading out without a Memory", async () => {
    const model = mockTextModel("Hello!");
    useMockModels({ chat: model });

    await sendMessage("Hi");

    expect(promptOf(model)).not.toContain("from earlier Chats");
  });
});
