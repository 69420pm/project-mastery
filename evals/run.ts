/**
 * Runs evals for key prompts on demand (ARCHITECTURE decision 12):
 *
 *   pnpm evals                          # all evals
 *   pnpm evals tutor-asks-before-telling
 *
 * Evals make real model calls through AI Gateway (free tier in development),
 * so they never run in `pnpm check`, Vitest or CI. With Langfuse keys, each
 * fixture is synced to a Langfuse dataset and run with Langfuse's experiment
 * runner, which records a dataset run with traces and scores. Without keys,
 * the same task and scorers run locally and the results are only printed.
 */
import { LangfuseClient, type Evaluation } from "@langfuse/client";
import { isLangfuseConfigured } from "@/lib/tracing/env";
import { startTracing } from "@/lib/tracing/node";
import {
  experimentTask,
  loadFixture,
  type EvalDefinition,
  type EvalItem,
} from "./eval";
import { tutorAsksBeforeTelling } from "./tutor-asks-before-telling";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
const EVALS: EvalDefinition<any, any>[] = [tutorAsksBeforeTelling];

// Free-tier rate limits are per model: run items one at a time.
const MAX_CONCURRENCY = 1;

type ItemResult = { evaluations: Evaluation[] };

/** Share of items whose gate scores all passed. */
function passRate(gates: string[], items: ItemResult[]) {
  const passed = items.filter((item) =>
    gates.every((gate) =>
      item.evaluations.some((e) => e.name === gate && e.value === 1),
    ),
  ).length;
  return items.length === 0 ? 0 : passed / items.length;
}

async function runWithLangfuse<Input, Expected>(
  langfuse: LangfuseClient,
  definition: EvalDefinition<Input, Expected>,
  fixture: { description: string; items: EvalItem<Input, Expected>[] },
) {
  // The fixture is the source of truth: upsert it into the Langfuse dataset.
  await langfuse.api.datasets.create({
    name: definition.name,
    description: fixture.description,
  });
  for (const item of fixture.items) {
    await langfuse.api.datasetItems.create({
      datasetName: definition.name,
      id: `${definition.name}-${item.id}`,
      input: item.input,
      expectedOutput: item.expectedOutput,
    });
  }

  const dataset = await langfuse.dataset.get(definition.name);
  const result = await dataset.runExperiment({
    name: definition.name,
    description: fixture.description,
    task: experimentTask(definition),
    evaluators: definition.evaluators,
    runEvaluators: [
      async ({ itemResults }) => ({
        name: "pass_rate",
        value: passRate(definition.gates, itemResults),
      }),
    ],
    maxConcurrency: MAX_CONCURRENCY,
  });
  console.info(await result.format({ includeItemResults: true }));
  return passRate(definition.gates, result.itemResults);
}

async function runLocally<Input, Expected>(
  definition: EvalDefinition<Input, Expected>,
  fixture: { items: EvalItem<Input, Expected>[] },
) {
  const results: ItemResult[] = [];
  for (const item of fixture.items) {
    const output = await definition.task(item.input);
    const evaluations = (
      await Promise.all(
        definition.evaluators.map((evaluate) => evaluate({ ...item, output })),
      )
    ).flat();
    results.push({ evaluations });

    console.info(`\n● ${item.id}\n  ${output.replaceAll("\n", "\n  ")}`);
    for (const { name, value, comment } of evaluations) {
      console.info(
        `  ${value === 1 ? "✓" : "✗"} ${name}${comment ? `: ${comment}` : ""}`,
      );
    }
  }
  return passRate(definition.gates, results);
}

async function main() {
  if (process.env.CI) {
    throw new Error("Evals make real model calls and must not run in CI.");
  }

  const requested = process.argv.slice(2);
  const unknown = requested.filter(
    (name) => !EVALS.some((e) => e.name === name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown eval: ${unknown.join(", ")}. Available: ${EVALS.map((e) => e.name).join(", ")}`,
    );
  }
  const selected = EVALS.filter(
    (e) => requested.length === 0 || requested.includes(e.name),
  );

  const tracing = startTracing();
  const langfuse = isLangfuseConfigured() ? new LangfuseClient() : undefined;
  if (!langfuse) {
    console.info("Langfuse keys not set: results are printed, not recorded.");
  }

  let failed = false;
  try {
    for (const definition of selected) {
      console.info(`\n=== ${definition.name}`);
      const fixture = await loadFixture(definition);
      const rate = langfuse
        ? await runWithLangfuse(langfuse, definition, fixture)
        : await runLocally(definition, fixture);

      const verdict = rate >= definition.minPassRate ? "✓ passed" : "✗ failed";
      console.info(
        `\n${verdict}: pass rate ${rate.toFixed(2)} (minimum ${definition.minPassRate})`,
      );
      failed ||= rate < definition.minPassRate;
    }
  } finally {
    await langfuse?.flush();
    await tracing?.shutdown();
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
