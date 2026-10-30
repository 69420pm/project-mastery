import { describe, expect, test } from "vitest";
import { checkExtraction, kcBudget } from "./part-extraction";

const words = (count: number) => Array(count).fill("word").join(" ");

describe("kcBudget", () => {
  test.each([
    [10, 1],
    [300, 2],
    [1000, 7],
    [5000, 12],
  ])("asks %i words for %i KCs", (count, budget) => {
    expect(kcBudget([words(count)])).toBe(budget);
  });
});

describe("checkExtraction", () => {
  const kc = (name: string, chunkIds: string[]) => ({
    name,
    description: `About ${name}.`,
    type: "concept" as const,
    chunkIds,
    assumes: [" Limits ", "", "Sums", "Series", "Products"],
  });

  test("keeps known chunk ids and drops KCs without one, and links with an unknown end", () => {
    const checked = checkExtraction(
      {
        kcs: [
          kc("Vector", ["c1", "c9"]),
          kc("Ghost", ["c9"]),
          kc("Basis", ["c2"]),
        ],
        prerequisites: [
          { from: "vector", to: "Basis" },
          { from: "Ghost", to: "Basis" },
          { from: "Basis", to: "Basis" },
        ],
      },
      new Map([
        ["c1", "chunk-1"],
        ["c2", "chunk-2"],
      ]),
    );

    expect(checked.kcs.map((k) => [k.name, k.chunkIds])).toEqual([
      ["Vector", ["chunk-1"]],
      ["Basis", ["chunk-2"]],
    ]);
    expect(checked.kcs[0]!.assumes).toEqual(["Limits", "Sums", "Series"]);
    expect(checked.prerequisites).toEqual([{ from: 0, to: 1 }]);
  });
});
