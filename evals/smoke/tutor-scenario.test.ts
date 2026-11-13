import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GoldCourse } from "./gold-course";
import { parseScenario, setupRows, setupSchema } from "./tutor-scenario";

const gold: GoldCourse = {
  courseId: "course",
  kcs: [
    { id: "kc-a", name: "Gaussian elimination", description: "" },
    { id: "kc-b", name: "Reading off the solution", description: "" },
    { id: "kc-c", name: "Subspaces", description: "" },
  ],
  prerequisites: [],
  topics: [
    {
      id: "t1",
      name: "Linear systems",
      centralQuestion: "?",
      kcs: ["kc-a", "kc-b"],
    },
  ],
  exercises: [
    {
      id: "ex-1",
      kcs: ["kc-a"],
      finalAnswers: [{ label: "x", value: "2", anyOrder: false }],
      markdown: "**Exercise 17.** Compute the inverse.",
      label: "Script p. 42",
      reserved: false,
    },
    {
      id: "ex-2",
      kcs: ["kc-c"],
      finalAnswers: null,
      markdown: "# Problem 2 of the Resit",
      label: "Script p. 51",
      reserved: true,
    },
  ],
};
const ids = { studentId: "student", chatId: "chat", sessionId: "session" };
const now = new Date("2026-11-12T10:00:00Z");

function plan(setup: unknown) {
  let n = 0;
  return setupRows(gold, setupSchema.parse(setup), ids, now, () => `id-${++n}`);
}

const rowsOf = (p: ReturnType<typeof plan>, table: string) =>
  p.inserts.find((insert) => insert.table === table)?.rows ?? [];

describe("setupRows", () => {
  it("stores earlier Attempts by Topic and KC name in a backdated session", () => {
    const p = plan({
      goal: "pass",
      attempts: [
        {
          topics: ["Linear systems"],
          kcs: ["Subspaces"],
          daysAgo: 3,
          result: "partial",
        },
      ],
    });
    expect(p.goal).toBe("pass");
    expect(p.inserts.map((i) => i.table)).toEqual([
      "study_sessions",
      "questions",
      "question_kcs",
      "attempts",
    ]);
    expect(rowsOf(p, "attempts")).toEqual(
      ["kc-c", "kc-a", "kc-b"].map((kc_id) =>
        expect.objectContaining({
          kc_id,
          owner: "student",
          session_id: "id-1",
          question_id: "id-2",
          result: "partial",
          help: "none",
          created_at: "2026-11-09T10:00:00.000Z",
        }),
      ),
    );
  });

  it("puts an open Question on an Exercise in the Chat's session and history", () => {
    const p = plan({
      openQuestion: { leadIn: "Try this one.", exercise: "Exercise 17" },
    });
    expect(rowsOf(p, "questions")).toEqual([
      expect.objectContaining({
        session_id: "session",
        exercise_id: "ex-1",
        prompt: gold.exercises[0]!.markdown,
        asked_at: now.toISOString(),
      }),
    ]);
    expect(rowsOf(p, "questions")[0]).not.toHaveProperty("graded_at");
    expect(rowsOf(p, "question_kcs")).toEqual([
      { question_id: "id-1", kc_id: "kc-a" },
    ]);
    const [opening, reply] = rowsOf(p, "chat_messages");
    expect(opening).toMatchObject({ chat_id: "chat", role: "user" });
    expect(reply!.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-ask",
        input: expect.objectContaining({ kcIds: ["kc-a"], problemId: "ex-1" }),
        output: { questionId: "id-1" },
      }),
    );
  });

  it("stores a graded mock the Chat goes through, and dated Memory lines", () => {
    const p = plan({
      memory: [{ daysAgo: 2, text: "Prefers examples first." }],
      mock: {
        daysAgo: 1,
        items: [
          { exercise: "Exercise 17", points: 10, awarded: 4, answer: "x = 3" },
        ],
      },
    });
    const [mock] = rowsOf(p, "mock_exams");
    expect(mock).toMatchObject({
      status: "graded",
      score: 4,
      course_id: "course",
    });
    expect(p.sessionMockId).toBe(mock!.id);
    expect(rowsOf(p, "mock_items")).toEqual([
      expect.objectContaining({
        mock_id: mock!.id,
        points: 10,
        points_awarded: 4,
      }),
    ]);
    expect(rowsOf(p, "attempts")).toEqual([
      expect.objectContaining({ kc_id: "kc-a", result: "partial" }),
    ]);
    expect(rowsOf(p, "memories")).toEqual([
      expect.objectContaining({ text: "2026-11-10: Prefers examples first." }),
    ]);
  });

  it("refuses unknown names and the Reserved exam", () => {
    expect(() => plan({ attempts: [{ kcs: ["Nope"], daysAgo: 1 }] })).toThrow(
      /No KC named "Nope"/,
    );
    expect(() =>
      plan({ openQuestion: { leadIn: "Go.", exercise: "Problem 2" } }),
    ).toThrow(/Reserved exam/);
  });
});

describe("the scenario files", () => {
  const dir = "evals/tutor/scenarios";

  it("each parse, with a persona, moves and a checklist", async () => {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(10);
    for (const file of files) {
      const text = await readFile(path.join(dir, file), "utf8");
      expect(() => parseScenario(text), file).not.toThrow();
      for (const heading of [
        "## Persona",
        "## Moves",
        "## Expected behaviour",
      ]) {
        expect(text, `${file}: ${heading}`).toContain(heading);
      }
    }
  });
});
