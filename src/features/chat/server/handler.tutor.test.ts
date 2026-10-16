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

const DAY_MS = 24 * 60 * 60 * 1000;

/** A stored correct attempt on a KC, at `createdAt`. */
const attempt = (kcId: string, createdAt: string, exerciseId?: string) =>
  db.tables.attempts.push({
    id: randomUUID(),
    owner: STUDENT,
    course_id: COURSE,
    kc_id: kcId,
    exercise_id: exerciseId ?? null,
    correct: true,
    help: "none",
    created_at: createdAt,
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

  test("list the due reviews, and admit candidates whose Prerequisites are taught", async () => {
    const model = mockTextModel("What is the thrust equation?");
    useMockModels({ chat: model });
    seedMap();
    // Taught four days ago, so due since three days.
    attempt(MAP.thrust, new Date(Date.now() - 4 * DAY_MS).toISOString());

    await send(firstMessage());

    const prompt = promptOf(model, 0);
    expect(prompt).toContain(
      `- Thrust equation (id ${MAP.thrust}, procedure; level 1, overdue by 3 days)`,
    );
    expect(prompt).toContain(
      `- Propulsive efficiency (id ${MAP.efficiency}, concept; anchors: Thrust equation (id ${MAP.thrust}))`,
    );
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

const EXAM = "aaaaaaaa-a000-4000-8000-000000000002";
const chunkOf = (n: number) => `aaaaaaaa-c400-4000-8000-0000000001${n}0`;

/** An exam Exercise with a paired solution, and a lecture one with a generated one. */
function seedExercises() {
  seedMap();
  const owned = { owner: STUDENT, course_id: COURSE };
  db.tables.materials.push({
    ...owned,
    id: EXAM,
    name: "Exam 2024",
    is_exam: true,
    created_at: "2025-12-02T00:00:00.000Z",
  });
  const chunk = (n: number, material: string, markdown: string) =>
    db.tables.chunks.push({
      ...owned,
      id: chunkOf(n),
      material_id: material,
      position: n,
      page_from: n,
      page_to: n,
      markdown,
    });
  chunk(1, EXAM, "Compute the thrust of the engine.");
  chunk(2, EXAM, "Solution: 42 kN.");
  chunk(3, MAP.material, "Why does thrust grow with exhaust speed?");
  const exercise = (n: number, status: string, solution: string | null) => {
    db.tables.exercises.push({
      ...owned,
      id: `ex-${n}`,
      question_chunk_id: chunkOf(n),
      name: `Ex. ${n}`,
      task_type: "compute thrust",
      solution_status: status,
      solution,
      difficulty: 2,
      position: n,
    });
    db.tables.exercise_kcs.push({
      ...owned,
      exercise_id: `ex-${n}`,
      kc_id: MAP.thrust,
    });
  };
  exercise(1, "disputed", null);
  exercise(3, "generated", "Generated: thrust is proportional to $v_e$.");
  db.tables.exercise_solutions.push({
    ...owned,
    exercise_chunk_id: chunkOf(1),
    solution_chunk_id: chunkOf(2),
    status: "paired",
  });
  db.tables.exercise_solutions.push({
    ...owned,
    exercise_chunk_id: chunkOf(3),
    solution_chunk_id: null,
    status: "no_solution",
  });
}

describe("findExercises", () => {
  test("gives the model old-exam Exercises first with solutions, labels and links", async () => {
    const model = mockToolModel(
      [[{ toolName: "findExercises", input: { kcIds: [MAP.thrust] } }]],
      "Try Ex. 1 first.",
    );
    useMockModels({ chat: model });
    seedExercises();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Try Ex. 1 first.");
    const result = promptOf(model, 1);
    expect(result.indexOf("Ex. 1")).toBeLessThan(result.indexOf("Ex. 3"));
    expect(result).toContain("Compute the thrust of the engine.");
    // The paired solution chunk, labelled disputed.
    expect(result).toContain("Solution: 42 kN.");
    expect(result).toContain("check it before relying on it");
    // The generated solution, labelled as such.
    expect(result).toContain("Generated: thrust is proportional");
    expect(result).toContain("generated by the AI");
    expect(result).toContain(
      `/courses/${COURSE}/materials/${EXAM}#chunk-${chunkOf(1)}`,
    );
    expect(result).toContain("Thrust equation");
  });

  test("skips Exercises the Student has attempted, and says when none are left", async () => {
    const finding = () =>
      mockToolModel(
        [[{ toolName: "findExercises", input: { kcIds: [MAP.thrust] } }]],
        "Try this one.",
      );
    seedExercises();
    attempt(MAP.thrust, new Date().toISOString(), "ex-1");

    const first = finding();
    useMockModels({ chat: first });
    await send(firstMessage());
    attempt(MAP.thrust, new Date().toISOString(), "ex-3");
    const second = finding();
    useMockModels({ chat: second });
    await send(firstMessage());

    expect(promptOf(first, 1)).toContain("Ex. 3");
    expect(promptOf(first, 1)).not.toContain("Ex. 1");
    expect(promptOf(second, 1)).toContain(
      "The Student has tried every Exercise of this Course for these KCs",
    );
  });

  test("refuses ids of no KC of the Course, and the reply continues", async () => {
    const model = mockToolModel(
      [[{ toolName: "findExercises", input: { kcIds: ["made-up"] } }]],
      "Let's go on.",
    );
    useMockModels({ chat: model });
    seedExercises();

    const reply = await send(firstMessage());

    expect(reply.text).toBe("Let's go on.");
    expect(db.tables.chat_messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-findExercises",
        errorText: expect.stringContaining(
          "These are no KC ids of this Course: made-up.",
        ),
      }),
    );
  });
});
