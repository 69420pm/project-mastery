/**
 * `pnpm evals:report`: where every registered eval stands, from the latest
 * run in Langfuse. Thresholds come from each `EvalDefinition`.
 */
import type { EvalDefinition } from "./eval";
import type { EvalRun, ReportLangfuse } from "./langfuse";

export type ReportRow = {
  eval: string;
  gates: string[];
  minPassRate: number;
  /** Undefined when the eval has no run yet. */
  run?: {
    date: string;
    /** Mean score per gate, undefined for a gate no item scored. */
    means: Record<string, number | undefined>;
    passRate: number;
    passed: boolean;
    costUsd: number | undefined;
  };
};

type ReportInput = {
  definition: Pick<
    EvalDefinition<unknown, unknown>,
    "name" | "gates" | "minPassRate"
  >;
  /** Number of items in the fixture; items a run skipped count as failed. */
  total: number;
};

export function reportRow(
  { definition, total }: ReportInput,
  run: EvalRun | undefined,
): ReportRow {
  const { name, gates, minPassRate } = definition;
  if (!run) return { eval: name, gates, minPassRate };

  const means = Object.fromEntries(
    gates.map((gate) => {
      const values = run.items.flatMap((item) => item[gate] ?? []);
      const mean =
        values.length === 0
          ? undefined
          : values.reduce((sum, value) => sum + value, 0) / values.length;
      return [gate, mean];
    }),
  );
  const passedItems = run.items.filter((item) =>
    gates.every((gate) => item[gate] === 1),
  ).length;
  const passRate = total === 0 ? 0 : passedItems / total;
  return {
    eval: name,
    gates,
    minPassRate,
    run: {
      date: run.date,
      means,
      passRate,
      passed: passRate >= minPassRate,
      costUsd: run.costUsd,
    },
  };
}

export function buildReport(langfuse: ReportLangfuse, inputs: ReportInput[]) {
  return Promise.all(
    inputs.map(async (input) =>
      reportRow(input, await langfuse.latestRun(input.definition.name)),
    ),
  );
}

/** Renders the rows as one aligned table. */
export function formatReport(rows: ReportRow[]) {
  const header = ["eval", "run", "mean score", "pass rate", "result", "cost"];
  const body = rows.map((row) => {
    const { run } = row;
    if (!run) return [row.eval, "never run", "", "", "", ""];
    const means = row.gates
      .map((gate) => `${gate} ${run.means[gate]?.toFixed(2) ?? "-"}`)
      .join(", ");
    return [
      row.eval,
      run.date.slice(0, 10),
      means,
      `${run.passRate.toFixed(2)} (min ${row.minPassRate})`,
      run.passed ? "pass" : "FAIL",
      run.costUsd === undefined ? "-" : `$${run.costUsd.toFixed(4)}`,
    ];
  });
  const widths = header.map((_, column) =>
    Math.max(...[header, ...body].map((line) => line[column]?.length ?? 0)),
  );
  return [header, ...body]
    .map((line) =>
      line
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
