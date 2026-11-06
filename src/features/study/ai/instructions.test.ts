import { expect, test } from "vitest";
import { tutorInstructions } from "@/features/study/ai/instructions";
import type { TutorContext } from "@/features/study/types";

const context: TutorContext = {
  today: "2026-10-18",
  examDate: null,
  goal: null,
  memory: "",
  briefNotes: null,
  materialNotes: [],
};

test("hold the dates, the goal, the Memory, the Brief's notes and the Material notes", () => {
  const instructions = tutorInstructions({
    ...context,
    examDate: "2027-02-10",
    goal: "good_grade",
    memory: "2026-10-01: Likes worked examples.",
    briefNotes: "The exam is open book.",
    materialNotes: [{ material: "Lecture 1", text: "Vectors are bold." }],
  });

  for (const part of [
    "Today is 2026-10-18. The exam date: 2027-02-10.",
    "The Student's goal is a good grade",
    "2026-10-01: Likes worked examples.",
    "The exam is open book.",
    "- Lecture 1:\nVectors are bold.",
  ]) {
    expect(instructions).toContain(part);
  }
});

test("leave out what the context lacks", () => {
  const instructions = tutorInstructions(context);

  expect(instructions).toContain("The exam date: not set.");
  for (const absent of [
    "goal is",
    "What you know about this Student",
    "in the Brief",
    "Notation and conventions",
  ]) {
    expect(instructions).not.toContain(absent);
  }
});
