import { describe, expect, test } from "vitest";
import { clusterKcs, cosineSimilarity, mergeTargets } from "./kc-clusters";

describe("cosineSimilarity", () => {
  test("is 1 for equal directions, 0 for orthogonal or zero vectors", () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("clusterKcs", () => {
  test("joins alike pairs into clusters", () => {
    expect(
      clusterKcs([
        { a: "a", b: "b", similarity: 0.9 },
        { a: "b", b: "c", similarity: 0.86 },
        { a: "x", b: "y", similarity: 0.95 },
      ]),
    ).toEqual([
      ["a", "b", "c"],
      ["x", "y"],
    ]);
  });

  test("splits a cluster that would grow too large, keeping the most alike together", () => {
    expect(
      clusterKcs(
        [
          { a: "a", b: "b", similarity: 0.99 },
          { a: "c", b: "d", similarity: 0.98 },
          { a: "b", b: "c", similarity: 0.86 },
        ],
        3,
      ),
    ).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("mergeTargets", () => {
  test("merges new KCs into the oldest stored KC of their group", () => {
    const cluster = [
      { key: "new1", stored: false as const },
      { key: "kc:young", stored: true as const, createdAt: "2026-02-01" },
      { key: "kc:old", stored: true as const, createdAt: "2026-01-01" },
      { key: "new2", stored: false as const },
      { key: "new3", stored: false as const },
    ];

    expect(
      mergeTargets(cluster, [
        ["new1", "kc:young", "kc:old"],
        ["new2", "new3"],
        ["new1", "new2", "elsewhere"],
      ]),
    ).toEqual(
      new Map([
        ["new1", "kc:old"],
        ["new3", "new2"],
      ]),
    );
  });
});
