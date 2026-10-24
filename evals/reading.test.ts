// @vitest-environment node
import { expect, test, vi } from "vitest";
import { loadFixture } from "./eval";
import { readingEval, readingGates, scoreReading } from "./reading";

vi.mock("server-only", () => ({}));

test("the fixture is about 18 cases: each section clean, as slides and as notes", async () => {
  const { items } = await loadFixture(readingEval);
  expect(items.length).toBeGreaterThanOrEqual(15);
  const sections = new Set(items.map((i) => i.id.replace(/-[a-z]+$/, "")));
  for (const section of sections) {
    const variants = items.filter((i) => i.id.startsWith(`${section}-`));
    expect(variants.map((i) => i.id.slice(section.length + 1))).toEqual([
      "clean",
      "slides",
      "notes",
    ]);
  }
  for (const { input } of items) {
    for (const chunk of input.chunks) {
      expect(chunk.pageFrom).toBeGreaterThanOrEqual(input.section.pageFrom);
      expect(chunk.pageTo).toBeLessThanOrEqual(input.section.pageTo);
    }
  }
});

test("a case scores correct only when the mode call picks its label", () => {
  const expected = {
    labelStatus: "draft" as const,
    mode: "study_text" as const,
  };
  const answer = (mode: string) => JSON.stringify({ mode, reason: "Why." });
  expect(scoreReading(answer("study_text"), expected)).toEqual({ correct: 1 });
  expect(scoreReading(answer("annotated"), expected)).toEqual({ correct: 0 });
});

test("the gate needs at least 80% mode accuracy", () => {
  const item = (correct: number) => ({
    evaluations: [{ name: "mode_correct", value: correct }],
  });
  expect(readingGates([1, 1, 1, 1, 0].map(item)).passed).toBe(true);
  expect(readingGates([1, 1, 1, 0, 0].map(item)).passed).toBe(false);
});
