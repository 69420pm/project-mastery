import { expect, test } from "vitest";
import { tutorInstructions } from "@/features/study/ai/instructions";
import type { TutorContext } from "@/features/study/types";

const context: TutorContext = {
  today: "2026-10-18",
  examDate: null,
  hasMap: false,
  phase: null,
  goal: null,
  memory: "",
  mapPath: "/courses/c/map",
  dueReviews: { kcs: [], more: 0 },
  todayPlan: { next: null, hint: null, fitLine: null },
};

test("hold the next Topic's KCs in teaching order with its anchors, the hint and the fit line", () => {
  const instructions = tutorInstructions({
    ...context,
    hasMap: true,
    phase: "deepen",
    todayPlan: {
      next: {
        id: "t1",
        name: "Nozzles",
        centralQuestion: "How does a nozzle speed up its gas?",
        kcs: [
          { id: "k1", name: "Nozzle shape", type: "concept", taught: true },
          { id: "k2", name: "Exit velocity", type: "procedure", taught: false },
        ],
        anchors: [{ id: "p1", name: "Momentum" }],
      },
      hint: "Practice exam-style problems",
      fitLine: "Deepen phase. At your pace, 3 of 3 Topics fit.",
    },
  });

  expect(instructions).toContain(
    [
      "Next Topic: Nozzles. Central question: How does a nozzle speed up its gas?",
      "Its KCs in teaching order:",
      "- Nozzle shape (id k1, concept; taught)",
      "- Exit velocity (id k2, procedure; not taught yet)",
      "Anchors (the prior knowledge and KCs of other Topics it docks onto):",
      "- Momentum (id p1)",
    ].join("\n"),
  );
  expect(instructions).toContain(
    "Today's suggestion for the Student: Practice exam-style problems.",
  );
  expect(instructions).toContain(
    "The study plan: Deepen phase. At your pace, 3 of 3 Topics fit.",
  );
});

test("render a context stored before #177 without a Today plan", () => {
  const stored = { ...context, hasMap: true, todayPlan: undefined };
  expect(tutorInstructions(stored as unknown as TutorContext)).toContain(
    "The study plan has no next Topic right now.",
  );
});

const MEMORY_HEADING = "What you know about this Student from earlier Chats:";

test("hold every section and the three rules", () => {
  const instructions = tutorInstructions(context);

  for (const phrase of [
    "You are the AI in Project Mastery",
    "1. Attempt before help.",
    "2. The Student produces.",
    "3. Cite the course.",
    "How you tutor:",
    "Your Memory of this Student in this Course",
    "Scope: you help with studying",
    "Language and format:",
    "Today is 2026-10-18. The exam date: not set.",
  ]) {
    expect(instructions).toContain(phrase);
  }
  expect(instructions).not.toContain(MEMORY_HEADING);
});

test("hold the Memory under its heading when it is set", () => {
  const instructions = tutorInstructions({
    ...context,
    memory: "2026-10-01: Likes proofs.",
  });

  expect(instructions).toContain(
    `${MEMORY_HEADING}\n\n2026-10-01: Likes proofs.`,
  );
});
