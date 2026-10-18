import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { tutorTools } from "@/features/study/ai/tools";

/** The input limits the model meets, read off the tools themselves. */

const tools = tutorTools({
  readKcs: async () => [],
  findExercises: async () => ({ exercises: [] }),
  recordAttempt: async () => [],
  remember: async () => {},
});

const accepts = (name: keyof typeof tools, input: unknown) =>
  (tools[name].inputSchema as z.ZodType).safeParse(input).success;

const kcIds = (n: number) => Array.from({ length: n }, (_, i) => `kc-${i}`);
const tested = (n: number) => kcIds(n).map((kcId) => ({ kcId, correct: true }));

describe.each(["readKcs", "findExercises"] as const)("%s", (name) => {
  test("takes 1 to 8 KCs", () => {
    expect(accepts(name, { kcIds: kcIds(1) })).toBe(true);
    expect(accepts(name, { kcIds: kcIds(8) })).toBe(true);
    expect(accepts(name, { kcIds: [] })).toBe(false);
    expect(accepts(name, { kcIds: kcIds(9) })).toBe(false);
  });
});

test("recordAttempt takes 1 to 8 KCs", () => {
  const input = (n: number) => ({ help: "none", kcs: tested(n) });
  expect(accepts("recordAttempt", input(8))).toBe(true);
  expect(accepts("recordAttempt", input(0))).toBe(false);
  expect(accepts("recordAttempt", input(9))).toBe(false);
});

test("remember takes one line of at most 300 characters", () => {
  const text = (value: string) => accepts("remember", { text: value });
  expect(text("x".repeat(300))).toBe(true);
  expect(text("")).toBe(false);
  expect(text("x".repeat(301))).toBe(false);
  expect(text("Likes proofs\nHates graphs")).toBe(false);
  expect(text("Likes proofs\r")).toBe(false);
});
