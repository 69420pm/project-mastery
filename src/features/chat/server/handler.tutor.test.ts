// @vitest-environment node
// The chat handler as a tutor: the instructions with the tutor context, and
// the getTopic tool. Shared setup and helpers: handler-testing.ts.
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
  test("hold the rules and the dates", async () => {
    const model = mockTextModel("What do you remember of Newton's law?");
    useMockModels({ chat: model });
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
  });

  test("come from the context sent on the reply's start and saved with it", async () => {
    useMockModels({ chat: mockTextModel("Let's start.") });
    const body = firstMessage();

    const reply = await send(body);

    const context = reply.startMetadata?.tutorContext;
    expect(context).toMatchObject({
      today: new Date().toISOString().slice(0, 10),
    });
    const [studentRow, replyRow] = db.tables.chat_messages.filter(
      (row) => row.chat_id === body.chatId,
    );
    expect(studentRow?.tutor_context).toBeNull();
    expect(replyRow?.tutor_context).toEqual(context);
  });

  test("give the goal and the Brief's notes", async () => {
    const model = mockTextModel("Let's go.");
    useMockModels({ chat: model });
    db.tables.briefs.push({
      owner: STUDENT,
      course_id: COURSE,
      exam_date: "2026-12-03",
      goal: "good_grade",
      notes: "New to linear algebra; no prior knowledge.",
    });

    await send(firstMessage());

    const prompt = promptOf(model, 0);
    expect(prompt).toContain("New to linear algebra; no prior knowledge.");
    expect(prompt).toContain("goal is a good grade");
  });
});

describe("getTopic", () => {
  test("gives the model the Topic with each asked KC's sources and links, and the Student only the text", async () => {
    const model = mockToolModel(
      [
        [
          {
            toolName: "getTopic",
            input: { topicId: MAP.topic, kcIds: [MAP.thrust] },
          },
        ],
      ],
      "How would you start?",
    );
    useMockModels({ chat: model });
    seedMap();
    const body = firstMessage();

    const reply = await send(body);

    expect(reply).toMatchObject({ status: 200, text: "How would you start?" });
    expect(reply.error).toBeUndefined();
    const result = promptOf(model, 1);
    expect(result).toContain("Thrust equation, as the lecture states it.");
    expect(result).toContain("How does an engine make thrust?");
    // Efficiency is in the Topic, but its sources were not asked for.
    expect(result).toContain("Propulsive efficiency");
    // The anchor, with its recall band.
    expect(result).toContain("Newton's second law");
    expect(result).toContain('"band":"new"');
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
    expect(stored.map(({ type }) => type)).toContain("tool-getTopic");
    expect(db.tables.ai_usage).toEqual([
      expect.objectContaining({ task: "chat", input_tokens: 20 }),
    ]);
  });

  test("reads KCs by id alone without a Topic, with their sources", async () => {
    const model = mockToolModel(
      [[{ toolName: "getTopic", input: { kcIds: [MAP.thrust] } }]],
      "Let's review.",
    );
    useMockModels({ chat: model });
    seedMap();

    await send(firstMessage());

    const prompt = model.doStreamCalls[1]!.prompt;
    const result = JSON.stringify(prompt.at(-1));
    expect(result).toContain("Thrust equation, as the lecture states it.");
    expect(result).toContain("Lecture 7");
    expect(result).toContain('"centralQuestion":null');
    expect(result).toContain('"readingSections":null');
    // Only the KCs asked for, not the rest of a Topic.
    expect(result).not.toContain("Propulsive efficiency");
  });

  test("gives at most 3 sources per KC, in reading order", async () => {
    const model = mockToolModel(
      [[{ toolName: "getTopic", input: { topicId: MAP.topic } }]],
      "Let's start.",
    );
    useMockModels({ chat: model });
    seedMap();
    for (const position of [3, 2]) {
      const id = `aaaaaaaa-c400-4000-8000-00000000000${position + 1}`;
      db.tables.chunks.push({
        owner: STUDENT,
        course_id: COURSE,
        id,
        material_id: MAP.material,
        position,
        page_from: 9,
        page_to: 9,
        label: "content",
        markdown: `Chunk ${position}`,
      });
      db.tables.kc_sources.push({
        owner: STUDENT,
        course_id: COURSE,
        kc_id: MAP.thrust,
        chunk_id: id,
      });
    }

    await send(firstMessage());

    const result = promptOf(model, 1);
    expect(result).toContain('"pages":"p. 3"');
    expect(result).toContain('"pages":"pp. 4–5"');
    expect(result).toContain("Chunk 2");
    expect(result).not.toContain("Chunk 3");
  });

  test.each([
    [
      "a Topic id outside the Course",
      { topicId: "made-up" },
      "made-up is no Topic id of this Course",
    ],
    [
      "a KC outside the Topic",
      { topicId: MAP.topic, kcIds: [MAP.thrust, MAP.newton] },
      `These KCs are not in this Topic: ${MAP.newton}.`,
    ],
    [
      "a KC outside the Course, read without a Topic",
      { kcIds: [MAP.thrust, "made-up"] },
      "These are no KC ids of this Course: made-up.",
    ],
  ])("refuses %s, and the reply continues", async (_name, input, refusal) => {
    const model = mockToolModel(
      [[{ toolName: "getTopic", input }]],
      "Let's start with thrust.",
    );
    useMockModels({ chat: model });
    seedMap();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Let's start with thrust.");
    expect(promptOf(model, 1)).toContain(refusal);
    // Stored as the tool's error, which the model sees on the next turn.
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-getTopic",
        errorText: expect.stringContaining(refusal),
      }),
    );
  });
});

describe("guided reading", () => {
  // Cut on read from the chunks the Topic's KCs cite; the id pins the cut.
  const SECTION = MAP.section;

  test("showReading ends the reply with the section's text", async () => {
    const model = mockToolModel(
      [
        [
          {
            toolName: "showReading",
            input: { sectionId: SECTION, purpose: "What makes thrust?" },
          },
        ],
      ],
      "Never reached.",
    );
    useMockModels({ chat: model });
    seedMap();

    const reply = await send(firstMessage());

    expect(model.doStreamCalls).toHaveLength(1);
    expect(reply.text).toBe("");
    const part = (
      db.tables.chat_messages.at(-1)!.parts as Array<{
        type: string;
        output?: unknown;
      }>
    ).find(({ type }) => type === "tool-showReading");
    expect(part?.output).toEqual({
      label: "Lecture 7, pp. 3–5",
      chunks: [
        "Chunk 0: $F = \\dot m (v_e - v_0)$",
        "Chunk 1: $F = \\dot m (v_e - v_0)$",
      ],
    });
  });
});
