// @vitest-environment node
// The chat handler as a tutor: the instructions with the tutor context, and
// the readKcs tool. Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { mockTextModel, mockToolModel, useMockModels } from "@/lib/ai/testing";
import {
  COURSE,
  MAP,
  STUDENT,
  db,
  seedMap,
  send,
  userMessage,
} from "./handler-testing";

vi.mock("server-only", () => ({}));

const firstMessage = (text = "Let's start studying.") => ({
  chatId: randomUUID(),
  courseId: COURSE,
  message: userMessage(text),
});

const promptOf = (
  model: ReturnType<typeof mockTextModel>,
  call: number,
): string => JSON.stringify(model.doStreamCalls[call]!.prompt);

describe("the instructions", () => {
  test("hold the rules, the dates and the candidates with their anchors", async () => {
    const model = mockTextModel("What do you remember of Newton's law?");
    useMockModels({ chat: model });
    seedMap();
    db.tables.briefs.push({
      owner: STUDENT,
      course_id: COURSE,
      exam_date: "2026-12-03",
    });

    await send(firstMessage());

    const prompt = promptOf(model, 0);
    expect(prompt).toContain("Attempt before help.");
    expect(prompt).toContain("Never show the Student ids or tool names.");
    expect(prompt).toContain("Write all mathematics in LaTeX");
    expect(prompt).toContain(
      `Today is ${new Date().toISOString().slice(0, 10)}`,
    );
    expect(prompt).toContain("The exam date: 2026-12-03.");
    expect(prompt).toContain("Big idea: Thrust generation");
    expect(prompt).toContain(
      `- Thrust equation (id ${MAP.thrust}, procedure; anchors: Newton's second law (id ${MAP.prior}))`,
    );
    // Its Prerequisite is not prior knowledge.
    expect(prompt).not.toContain("Propulsive efficiency");
  });

  test("without a map, have no candidates and point to the map page", async () => {
    const model = mockTextModel("Hi.");
    useMockModels({ chat: model });

    await send(firstMessage("Hi"));

    const prompt = promptOf(model, 0);
    expect(prompt).toContain("The exam date: not set.");
    expect(prompt).toContain("no Knowledge map yet");
    expect(prompt).toContain(`/courses/${COURSE}/map`);
    expect(prompt).not.toContain("Big idea:");
  });
});

describe("readKcs", () => {
  test("gives the model each KC with its sources and links, and the Student only the text", async () => {
    const model = mockToolModel(
      [[{ toolName: "readKcs", input: { kcIds: [MAP.thrust] } }]],
      "How would you start?",
    );
    useMockModels({ chat: model });
    seedMap();
    const body = firstMessage();

    const reply = await send(body);

    expect(reply).toEqual({ status: 200, text: "How would you start?" });
    const result = promptOf(model, 1);
    expect(result).toContain("Thrust equation, as the lecture states it.");
    expect(result).toContain("Lecture 7");
    expect(result).toContain("p. 3");
    expect(result).toContain("pp. 4–5");
    expect(result).toContain(
      `/courses/${COURSE}/materials/${MAP.material}#chunk-${MAP.chunks[1]}`,
    );
    // The tool call is stored with the reply, and usage once over both steps.
    const stored = db.tables.chat_messages.at(-1)!.parts as Array<{
      type: string;
    }>;
    expect(stored.map(({ type }) => type)).toContain("tool-readKcs");
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ task: "chat", input_tokens: 20 }),
    ]);
  });

  test("refuses ids of no KC of the Course, and the reply continues", async () => {
    const model = mockToolModel(
      [[{ toolName: "readKcs", input: { kcIds: [MAP.thrust, "made-up"] } }]],
      "Let's start with thrust.",
    );
    useMockModels({ chat: model });
    seedMap();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Let's start with thrust.");
    const refusal = "These are no KC ids of this Course: made-up.";
    expect(promptOf(model, 1)).toContain(refusal);
    // Stored as the tool's error, which the model sees on the next turn.
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-readKcs",
        errorText: expect.stringContaining(refusal),
      }),
    );
  });
});
