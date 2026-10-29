import { describe, expect, test } from "vitest";
import { teachingOrder, topicOrder, type Topic } from "./topics";

const prerequisite = (from: string, to: string) => ({ from, to });

const topic = (id: string, kcs: string[]): Topic => ({
  id,
  bigIdea: "A",
  name: `Topic ${id}`,
  centralQuestion: `Why ${id}?`,
  kcs,
});

describe("Topic order", () => {
  test("teaching order puts in-Topic Prerequisites first, else keeps the given order", () => {
    expect(
      teachingOrder(
        ["k1", "k2", "k3", "k4"],
        [prerequisite("k3", "k1"), prerequisite("k9", "k2")],
      ),
    ).toEqual(["k2", "k3", "k1", "k4"]);
  });

  test("follows Prerequisites, then first source, and breaks a cycle at the earliest", () => {
    const ranks: Record<string, number> = { a1: 0, b1: 1, c1: 2, d1: 9 };
    const result = topicOrder(
      [
        topic("a", ["a1", "a2"]),
        topic("b", ["b1", "b2"]),
        topic("c", ["c1", "c2"]),
        topic("d", ["d1", "d2"]),
      ],
      [
        // a needs c, c needs b, and b and d need each other: the cycle
        // breaks at b, the earlier; d, with the latest source, comes last.
        prerequisite("c1", "a1"),
        prerequisite("b1", "c2"),
        prerequisite("d1", "b1"),
        prerequisite("b2", "d2"),
      ],
      (kcId) => ranks[kcId] ?? 99,
    );
    expect(result.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
  });
});
