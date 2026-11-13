// @vitest-environment node
// The chat handler's Questions (#251): ask and grade on the session's open
// Question, the session facts in the tutor context, and a session that goes
// through a graded Mock exam. Shared setup and helpers: handler-testing.ts.
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
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

type Model = ReturnType<typeof mockTextModel>;

const asking = (kcIds: string[] = [MAP.thrust, MAP.efficiency]) =>
  mockToolModel([[{ toolName: "ask", input: { prompt: "Why?", kcIds } }]], "");

/**
 * A new Chat whose first reply asks a question on `kcIds`. Named as a hook
 * for the lint rule, since it sets the mock models.
 */
function useAskedChat(kcIds?: string[]): Promise<string> {
  seedMap();
  const chatId = randomUUID();
  useMockModels({ chat: asking(kcIds) });
  return send({
    chatId,
    courseId: COURSE,
    message: userMessage("Quiz me"),
  }).then(() => chatId);
}

/** Answers in the Chat with `model` replying. */
function useReply(chatId: string, model: Model, text = "Mass flow.") {
  useMockModels({ chat: model });
  return send({ chatId, message: userMessage(text) });
}

const toolError = (toolName: string) =>
  (
    db.tables.chat_messages.at(-1)!.parts as Array<{
      type: string;
      toolName?: string;
      errorText?: string;
    }>
  ).find(
    // A call whose input failed the schema is stored as a dynamic tool.
    (part) =>
      part.type === `tool-${toolName}` ||
      (part.type === "dynamic-tool" && part.toolName === toolName),
  )?.errorText;

const newestUserText = (model: Model, call = 0) =>
  JSON.stringify(
    model.doStreamCalls[call]!.prompt.findLast(({ role }) => role === "user"),
  );

test("grade grades the open Question without an id, and ask waits for it", async () => {
  const chatId = await useAskedChat();

  // Answered but ungraded: a new question is refused.
  await useReply(chatId, asking());
  expect(toolError("ask")).toContain("grade it first");
  expect(db.tables.questions).toHaveLength(1);

  const grading = mockToolModel(
    [
      [
        {
          toolName: "grade",
          input: {
            results: [
              { kcId: MAP.thrust, result: "full" },
              { kcId: MAP.efficiency, result: "partial" },
            ],
            help: "some",
          },
        },
      ],
    ],
    "Well done.",
  );
  await useReply(chatId, grading, "And velocity.");

  expect(db.tables.attempts).toEqual([
    expect.objectContaining({
      kc_id: MAP.thrust,
      result: "full",
      help: "some",
    }),
    expect.objectContaining({ kc_id: MAP.efficiency, result: "partial" }),
  ]);
  expect(db.tables.questions[0]!.graded_at).not.toBeNull();
});

test("closeQuestion closes the Question without Attempts", async () => {
  const chatId = await useAskedChat();

  await useReply(
    chatId,
    mockToolModel(
      [[{ toolName: "closeQuestion", input: {} }]],
      "Let's look at something else.",
    ),
    "Can we do eigenvalues instead?",
  );

  expect(db.tables.questions[0]!.graded_at).not.toBeNull();
  expect(db.tables.attempts).toEqual([]);
});

test("grade without results is refused before it runs", async () => {
  const chatId = await useAskedChat();

  await useReply(
    chatId,
    mockToolModel(
      [[{ toolName: "grade", input: { help: "none", finalValues: [] } }]],
      "",
    ),
  );

  expect(toolError("grade")).toContain("Invalid input for tool grade");
  expect(toolError("grade")).toContain('"results"');
  expect(db.tables.questions[0]!.graded_at).toBeNull();
});

test("a reply that spent its steps on tool calls ends with text, on auto for Muse", async () => {
  const chatId = await useAskedChat();
  const failing = { toolName: "grade", input: { help: "none" } };
  const model = mockToolModel(
    [[failing], [failing], [failing], [failing]],
    "Both parts are right.",
  );

  await useReply(chatId, model);

  expect(model.doStreamCalls.map(({ toolChoice }) => toolChoice?.type)).toEqual(
    ["auto", "auto", "auto", "auto", "auto"],
  );
  expect(JSON.stringify(db.tables.chat_messages.at(-1)!.parts)).toContain(
    "Both parts are right.",
  );
});

test("grade drops a KC retired since the ask", async () => {
  const chatId = await useAskedChat();
  db.tables.kcs.find(({ id }) => id === MAP.efficiency)!.retired_at =
    new Date().toISOString();

  await useReply(
    chatId,
    mockToolModel(
      [
        [
          {
            toolName: "grade",
            input: {
              results: [
                { kcId: MAP.thrust, result: "full" },
                { kcId: MAP.efficiency, result: "wrong" },
              ],
              help: "none",
            },
          },
        ],
      ],
      "Good.",
    ),
  );

  expect(db.tables.attempts).toEqual([
    expect.objectContaining({ kc_id: MAP.thrust, result: "full" }),
  ]);
});

test("the context holds the open Question, today's checks and the opened Reading sections", async () => {
  seedMap();
  const chatId = randomUUID();
  useMockModels({
    chat: mockToolModel(
      [
        [
          {
            toolName: "showReading",
            input: { sectionId: MAP.section, purpose: "What makes thrust?" },
          },
        ],
      ],
      "",
    ),
  });
  await send({ chatId, courseId: COURSE, message: userMessage("Read") });
  await useReply(chatId, asking([MAP.thrust]), "Done reading.");
  const model = mockTextModel("Close.");
  await useReply(chatId, model);

  const context = newestUserText(model);
  expect(context).toContain(
    `Open Question, answered, to grade, on Thrust equation (KC id ${MAP.thrust}):\\n> Why?`,
  );
  expect(context).toContain(
    `Reading sections opened: Lecture 7, pp. 3–5 (section id ${MAP.section}).`,
  );
  expect(context).toContain("No KC checked today.");
});

test("a new Chat from a graded Mock exam goes through its tasks, most points lost first", async () => {
  const mockId = randomUUID();
  db.tables.mock_exams.push({
    id: mockId,
    owner: STUDENT,
    course_id: COURSE,
    status: "graded",
  });
  const item = (position: number, prompt: string, awarded: number) => ({
    id: randomUUID(),
    mock_id: mockId,
    owner: STUDENT,
    position,
    prompt,
    points: 6,
    points_awarded: awarded,
    steps: [{ points: awarded, reason: `${prompt} reason` }],
    graded_at: new Date().toISOString(),
    check: null,
    exercise_id: null,
    problem_id: null,
    question_id: null,
  });
  db.tables.mock_items.push(
    item(0, "Name the stages.", 5),
    item(1, "Derive thrust.", 1),
  );
  const model = mockTextModel("Let's start with thrust.");
  useMockModels({ chat: model });
  const chatId = randomUUID();

  await send({
    chatId,
    courseId: COURSE,
    mockId,
    message: userMessage("Let's go through my mock exam."),
  });

  expect(
    db.tables.study_sessions.find((s) => s.chat_id === chatId)!.mock_id,
  ).toBe(mockId);
  const context = newestUserText(model);
  expect(context).toContain("## The Mock exam this session goes through");
  expect(context.indexOf("Derive thrust.")).toBeLessThan(
    context.indexOf("Name the stages."),
  );
  expect(context).toContain("1. 1 of 6 points");
});

test("a mock that is not the Student's graded one is ignored", async () => {
  useMockModels({ chat: mockTextModel("Hello.") });
  const chatId = randomUUID();

  const sent = await send({
    chatId,
    courseId: COURSE,
    mockId: randomUUID(),
    message: userMessage("Hi"),
  });

  expect(sent.status).toBe(200);
  expect(
    db.tables.study_sessions.find((s) => s.chat_id === chatId)!.mock_id,
  ).toBeNull();
});
