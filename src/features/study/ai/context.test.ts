import { describe, expect, test } from "vitest";
import { renderTutorContext } from "@/features/study/ai/context";
import type { RankedItem } from "@/features/study/domain/ranking";
import { UNTAUGHT, type KcRecall } from "@/features/study/domain/replay";
import {
  tutorContext,
  type TutorContextInput,
} from "@/features/study/domain/tutor-context";

const NOW = new Date("2026-11-07T10:00:00Z");
const kc = (id: string) => ({ id, name: `KC ${id}`, assumes: [] });
const topic = (id: string, kcs: string[]) => ({
  id,
  name: `Topic ${id}`,
  centralQuestion: `Why ${id}?`,
  kcs,
});
const taught = (recallToday: number, due = false): KcRecall => ({
  ...UNTAUGHT,
  taught: true,
  learned: true,
  recallToday,
  due,
  nextReview: "2026-11-09",
});

/** A Course of two Topics, t1 (k1, k2) and t2 (k3), in a first session. */
function render(overrides: Partial<TutorContextInput> = {}): string {
  const input: TutorContextInput = {
    now: NOW,
    exam: { examDate: "2026-12-07", goal: "pass" },
    kcs: [kc("k1"), kc("k2"), kc("k3")],
    anchors: () => [],
    topics: [topic("t1", ["k1", "k2"]), topic("t2", ["k3"])],
    scope: [
      { id: "t1", status: "in_plan", pinnedAt: null },
      { id: "t2", status: "skipped", pinnedAt: null },
    ],
    ranked: [
      {
        kind: "topic",
        topicId: "t1",
        untaught: ["k1", "k2"],
        value: 2,
        minutes: 60,
      },
    ],
    recall: new Map(),
    attempts: [],
    session: {
      id: "s1",
      startedAt: "2026-11-07T09:48:00Z",
      questions: [],
      readings: [],
    },
    readings: new Map([["t1", [{ id: "r1", label: "Lecture 1, p. 2" }]]]),
    unseenProblems: [{ kcs: ["k2"] }, { kcs: ["k3"] }],
    notes: {
      topics: new Map([
        ["t1", "Mixes up k1 and k2."],
        ["t2", "Never shown."],
      ]),
      memory: "",
      briefNotes: null,
      materialNotes: [],
    },
    mock: null,
    ...overrides,
  };
  return renderTutorContext(tutorContext(input));
}

const review = (kcId: string): RankedItem => ({
  kind: "review",
  kcId,
  topicId: "t1",
  value: 1,
  minutes: 2,
});

test("a first session proposes the next Topic with its sections, stock and notes", () => {
  const text = render();
  expect(text).toMatch(
    /^<tutor-context>\nToday is 2026-11-07\. The exam is on 2026-12-07, in 30 days\./,
  );
  expect(text).toContain("Running for 12 minutes.");
  expect(text).toContain("No KC checked today.");
  expect(text).toContain("Next Topic: Topic t1 (Topic id t1): Why t1?");
  expect(text).toContain("KCs: KC k1 (KC id k1; new); KC k2 (KC id k2; new)");
  expect(text).toContain("Reading sections: Lecture 1, p. 2 (section id r1)");
  expect(text).toContain("Unseen Problems: 1");
  expect(text).toContain("## Topic notes: Topic t1\nMixes up k1 and k2.");
  expect(text).not.toContain("Never shown.");
  expect(text).not.toContain("## Last session");
});

test("due Reviews come first: 10 named, with their recall, and how many more", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
  const text = render({
    kcs: ids.map(kc),
    ranked: ids.map(review),
    recall: new Map(ids.map((id) => [id, taught(0.5, true)])),
  });
  expect(text).toContain("KC r0 (KC id r0; weak, recall 50%)");
  expect(text).toContain("KC r9 (KC id r9");
  expect(text).not.toContain("KC r10 (");
  expect(text).toContain("And 2 more.");
});

test("the final stretch names the first items of the ranking instead", () => {
  const text = render({
    exam: { examDate: "2026-11-10", goal: "good_grade" },
    ranked: [
      review("k3"),
      { kind: "topic", topicId: "t1", untaught: ["k1"], value: 1, minutes: 30 },
    ],
  });
  expect(text).toContain("The final stretch");
  expect(text).toContain(
    "- Review: KC k3 (KC id k3)\n- Topic: Topic t1 (Topic id t1)",
  );
  expect(text).not.toContain("Next Topic");
});

test("nothing in the plan is said plainly, and every Topic stays listed", () => {
  const text = render({ ranked: [] });
  expect(text).toContain("## Proposal\nNothing in the plan to propose.");
  // A Student can redirect to any Topic, skipped ones too.
  expect(text).toContain("Topic t2 (Topic id t2): skipped, 0 of 1 learned");
});

test("a Student who redirected: today's checks touch another Topic, whose notes show", () => {
  const text = render({
    recall: new Map([["k3", taught(0.95)]]),
    attempts: [
      {
        kcId: "k1",
        sessionId: "s0",
        createdAt: "2026-11-05T10:00:00Z",
        result: "full",
        help: "none",
      },
      {
        kcId: "k2",
        sessionId: "s0",
        createdAt: "2026-11-05T10:05:00Z",
        result: "partial",
        help: "some",
      },
      {
        kcId: "k3",
        sessionId: "s1",
        createdAt: "2026-11-07T09:55:00Z",
        result: "full",
        help: "none",
      },
    ],
    session: {
      id: "s1",
      startedAt: "2026-11-07T09:48:00Z",
      questions: [
        {
          prompt: "Why k3?",
          kcIds: ["k3"],
          answered: true,
          gradedAt: "2026-11-07T09:55:00Z",
        },
        { prompt: "And k1?", kcIds: ["k1"], answered: false, gradedAt: null },
      ],
      readings: [],
    },
  });
  expect(text).toContain("Checked today: KC k3 (KC id k3): full, help none.");
  expect(text).toContain("Last graded Question 5 minutes ago.");
  expect(text).toContain(
    "Open Question, not answered, on KC k1 (KC id k1):\n> And k1?",
  );
  expect(text).toContain("## Topic notes: Topic t2\nNever shown.");
  expect(text).toContain(
    "## Last session\n2026-11-05: Topic t1; 2 KCs checked, 1 below full.",
  );
  expect(text).toContain("Topic t2 (Topic id t2): skipped, 1 of 1 learned");
});

describe("a mock session", () => {
  test("lists the mock's tasks as given, with their points, answers and reasons", () => {
    const text = render({
      mock: [
        {
          prompt: "Derive k1.",
          answer: "I don't know.",
          points: 6,
          awarded: 0,
          reasons: ["No derivation (0 points)"],
          problemId: "e1",
        },
      ],
    });
    expect(text).toContain(
      "## The Mock exam this session goes through, most points lost first\n1. 0 of 6 points (problem id e1)\n> Derive k1.\nAnswer:\n> I don't know.\n- No derivation (0 points)",
    );
  });
});
