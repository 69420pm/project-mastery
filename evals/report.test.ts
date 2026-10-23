// @vitest-environment node
import { expect, test } from "vitest";
import { buildReport, formatReport, reportRow } from "./report";

const definition = { name: "chat", gates: ["behavior"], minPassRate: 0.8 };

test("passes when enough items pass every gate", () => {
  const row = reportRow(
    { definition, total: 5 },
    {
      date: "2026-10-23T10:00:00Z",
      items: [
        { behavior: 1 },
        { behavior: 1 },
        { behavior: 1 },
        { behavior: 1 },
        { behavior: 0 },
      ],
      costUsd: 0.0123,
    },
  );
  expect(row.run).toMatchObject({ passRate: 0.8, passed: true });
  expect(row.run?.means.behavior).toBeCloseTo(0.8);
});

test("items a run skipped count as failed", () => {
  const row = reportRow(
    { definition, total: 5 },
    {
      date: "2026-10-23",
      items: [{ behavior: 1 }, { behavior: 1 }],
      costUsd: 0,
    },
  );
  expect(row.run).toMatchObject({ passRate: 0.4, passed: false });
});

test("the table shows a never-run eval and a failing one", async () => {
  const rows = await buildReport(
    {
      latestRun: async (name) =>
        name === "chat"
          ? {
              date: "2026-10-23T10:00:00Z",
              items: [{ behavior: 0 }],
              costUsd: 0.5,
            }
          : undefined,
    },
    [
      { definition, total: 1 },
      { definition: { ...definition, name: "tutor" }, total: 1 },
    ],
  );
  const table = formatReport(rows);
  expect(table).toMatch(
    /chat\s+2026-10-23\s+behavior 0\.00\s+0\.00 \(min 0\.8\)\s+FAIL\s+\$0\.5000/,
  );
  expect(table).toMatch(/tutor\s+never run/);
});
