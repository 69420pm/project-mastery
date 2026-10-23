// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { SessionScore } from "./langfuse";
import { chatMetrics, scoreChats, type MetricsChat } from "./metrics";

vi.mock("server-only", () => ({}));

const text = (value: string) => [{ type: "text", text: value }];

/** A Student and the AI over 12 minutes, the AI asking twice of three turns. */
const chat: MetricsChat = {
  id: "chat-1",
  createdAt: "2026-10-20T10:00:00Z",
  messages: [
    {
      id: "u1",
      role: "user",
      parts: text("What is a derivative?"),
      createdAt: "2026-10-20T10:00:00Z",
    },
    {
      id: "a1",
      role: "assistant",
      parts: text("What do you think it measures?"),
      createdAt: "2026-10-20T10:00:05Z",
    },
    {
      id: "u2",
      role: "user",
      parts: text("The slope, I guess"),
      createdAt: "2026-10-20T10:02:00Z",
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "tool-readKcs" },
        ...text("Right. The slope **where**?**"),
      ],
      createdAt: "2026-10-20T10:02:05Z",
    },
    // A 30-minute pause counts as 5 active minutes.
    {
      id: "u3",
      role: "user",
      parts: text("At a point"),
      createdAt: "2026-10-20T10:32:00Z",
    },
    {
      id: "a3",
      role: "assistant",
      parts: text("Exactly."),
      createdAt: "2026-10-20T10:32:05Z",
    },
  ],
  replyCostUsd: new Map([
    ["a1", 0.01],
    ["a2", 0.02],
    ["a3", 0.005],
  ]),
};

test("computes each metric on a transcript", () => {
  const metrics = chatMetrics(chat);
  // Student: 4 + 4 + 3 words; AI: 6 + 4 + 1 words.
  expect(metrics.student_word_share).toBeCloseTo(11 / 22);
  expect(metrics.ai_question_share).toBeCloseTo(2 / 3);
  expect(metrics.active_minutes).toBe(7);
  expect(metrics.cost_per_active_hour).toBeCloseTo(0.035 / (7 / 60));
});

test("a Chat with one Student message has no active time to price", () => {
  const metrics = chatMetrics({ ...chat, messages: chat.messages.slice(0, 2) });
  expect(metrics.active_minutes).toBe(0);
  expect(metrics.cost_per_active_hour).toBeUndefined();
});

test("upserts scores on the Chat's session and skips mock-provider Chats", async () => {
  const written: SessionScore[] = [];
  const mock: MetricsChat = {
    ...chat,
    id: "chat-mock",
    messages: [
      ...chat.messages.slice(0, 1),
      {
        id: "m1",
        role: "assistant",
        parts: text('Mock reply to "What is a derivative?". This is…'),
        createdAt: "2026-10-20T10:00:05Z",
      },
    ],
  };

  const result = await scoreChats(
    { writeSessionScores: async (scores) => void written.push(...scores) },
    [chat, mock],
  );

  expect(result.skipped).toBe(1);
  expect(new Set(written.map((score) => score.sessionId))).toEqual(
    new Set(["chat-1"]),
  );
  expect(written.map((score) => score.name).toSorted()).toEqual([
    "active_minutes",
    "ai_question_share",
    "cost_per_active_hour",
    "student_word_share",
  ]);
  expect(written.every((score) => score.timestamp === chat.createdAt)).toBe(
    true,
  );
});
