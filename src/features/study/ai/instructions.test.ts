import { expect, test } from "vitest";
import { tutorInstructions } from "@/features/study/ai/instructions";
import type { TutorContext } from "@/features/study/types";

const context: TutorContext = {
  today: "2026-10-18",
  examDate: null,
  hasMap: false,
  phase: null,
  share: null,
  leftOutCount: null,
  goal: null,
  memory: "",
  mapPath: "/courses/c/map",
  dueReviews: { kcs: [], more: 0 },
  candidates: [],
};

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
