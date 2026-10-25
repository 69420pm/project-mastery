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
      "Next Topic: Nozzles (id t1). Central question: How does a nozzle speed up its gas?",
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

test("hold one block per stage and the session's stage when it has a Topic, and the session shape when it has none", () => {
  const staged = tutorInstructions({
    ...context,
    session: { stage: "review", afterReview: "work", minutes: 7 },
  });

  for (const stage of ["review", "orient", "prime", "read", "work"]) {
    expect(staged).toContain(`\n- ${stage}: `);
  }
  expect(staged).toContain(
    "Session stage: review. The session started 7 minutes ago.\nAfter the reviews, go to work.",
  );
  expect(staged).not.toContain("Session shape");
  expect(tutorInstructions(context)).toContain("Session shape");
  expect(tutorInstructions(context)).not.toContain("Session stage:");
});

test("a review session holds the queue in order instead of the learn guidance, or says nothing is due", () => {
  const kc = (id: string, type = "concept") => ({
    id,
    name: `KC ${id}`,
    type,
    topicId: "t1",
  });
  const review = tutorInstructions({
    ...context,
    hasMap: true,
    reviewQueue: [
      {
        topicId: "t1",
        kcs: [kc("a"), kc("b")],
        status: "retry",
        retryKcIds: ["b"],
      },
      {
        topicId: "t2",
        kcs: [kc("c", "procedure")],
        status: "open",
        retryKcIds: [],
      },
    ],
  });

  expect(review).toContain(
    [
      "Review queue, in order (Left: 1 open, 1 to retry.)",
      "1. done, to retry; retry: KC b",
      "  - KC a (id a, concept, Topic id t1)",
      "  - KC b (id b, concept, Topic id t1)",
      "2. open",
      "  - KC c (id c, procedure, Topic id t1)",
    ].join("\n"),
  );
  expect(review).toContain("Ask one question per open group");
  expect(review).not.toContain("Session shape");
  expect(review).not.toContain("No reviews are due.");
  expect(tutorInstructions({ ...context, reviewQueue: [] })).toContain(
    "nothing is due for review",
  );
});

test("a practice session poses Problems on the practice KCs instead of the learn guidance, or says to learn a Topic first", () => {
  const practice = tutorInstructions({
    ...context,
    hasMap: true,
    practiceKcs: [
      { id: "a", name: "KC a", type: "procedure", topicId: "t1" },
      { id: "b", name: "KC b", type: "concept", topicId: "t2" },
    ],
  });

  expect(practice).toContain(
    [
      "Practice KCs, most urgent first:",
      "- KC a (id a, procedure, Topic id t1)",
      "- KC b (id b, concept, Topic id t2)",
    ].join("\n"),
  );
  expect(practice).toContain("pose one Problem at a time through ask");
  expect(practice).not.toContain("Session shape");
  expect(practice).not.toContain("No reviews are due.");
  expect(tutorInstructions({ ...context, practiceKcs: [] })).toContain(
    "learns a Topic first",
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
