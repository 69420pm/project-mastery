import { expect, test } from "vitest";
import type { CheckReport } from "@/features/knowledge-map/schemas";
import { checkReportLine, pagesText } from "./check-report";

const report = (over: Partial<CheckReport>): CheckReport => ({
  chaptersWithoutKcs: [],
  exercisesWithoutKcs: [],
  duplicates: [],
  unitsBelowCoverage: [],
  unreadPages: [],
  unitsNotExtracted: [],
  ...over,
});

test("pagesText gives single pages and runs of pages", () => {
  expect(pagesText([10])).toBe("p. 10");
  expect(pagesText([38, 10, 36, 37])).toBe("pp. 10, 36–38");
});

test("names unread pages and Chapters covered in part, in one line", () => {
  expect(
    checkReportLine(
      report({
        unreadPages: [{ material: "Notes", pages: [10, 36, 37, 38] }],
        unitsBelowCoverage: [
          { chapter: "Bases", coverage: 0.2 },
          { chapter: "Sums", coverage: 0.4 },
          { chapter: "Sums", coverage: 0.3 },
        ],
      }),
    ),
  ).toBe(
    "The AI couldn't read pp. 10, 36–38 and covered 2 Chapters only in part",
  );
  expect(
    checkReportLine(
      report({
        unreadPages: [
          { material: "Notes", pages: [3] },
          { material: "Sheet 1", pages: [1, 2] },
        ],
      }),
    ),
  ).toBe("The AI couldn't read Notes p. 3, Sheet 1 pp. 1–2");
});

test("counts units given up on as Chapters covered in part", () => {
  expect(
    checkReportLine(
      report({
        unitsBelowCoverage: [{ chapter: "Sums", coverage: 0.3 }],
        unitsNotExtracted: ["Sums", "Linear maps"],
      }),
    ),
  ).toBe("The AI covered 2 Chapters only in part");
});

test("says nothing for a full build or no report", () => {
  expect(
    checkReportLine(report({ chaptersWithoutKcs: ["Preface"] })),
  ).toBeNull();
  expect(checkReportLine(null)).toBeNull();
});
