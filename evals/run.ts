/**
 * Runs evals for key prompts on demand (ADR 0012):
 *
 *   pnpm evals                          # all evals
 *   pnpm evals <name>                   # one eval
 *   pnpm evals draft <criterion> [--limit N]   # draft judge labels on traces
 *   pnpm evals calibrate <criterion>    # judge candidates against the labels
 *
 * Evals make real model calls through AI Gateway, so they never run in `pnpm check`, Vitest or CI. With Langfuse keys, each
 * fixture is synced to a Langfuse dataset and run with Langfuse's experiment
 * runner, which records a dataset run with traces and scores. Without keys,
 * the same task and scorers run locally and the results are only printed.
 */
// Must come first: lets evals import modules that use Next.js.
import "./next-aliases";
import { parseArgs } from "node:util";
import { LangfuseClient, type Evaluation } from "@langfuse/client";
import { AI_TASKS, aiTask, aiTaskCandidate } from "@/lib/ai/models";
import { isLangfuseConfigured } from "@/lib/tracing/env";
import { startTracing } from "@/lib/tracing/node";
import {
  experimentTask,
  guardQuota,
  isQuotaExhausted,
  loadFixture,
  QuotaExhaustedError,
  withQuotaGuard,
  type EvalDefinition,
  type EvalItem,
} from "./eval";
import { judgeReply, loadRubric } from "./judge";
import {
  calibrate,
  DEFAULT_DRAFT_LIMIT,
  draft,
  type JudgeCommandDeps,
} from "./judge-commands";
import { createEvalLangfuse } from "./langfuse";
import { EVALS } from "./registry";

// A few items at once: AI Gateway rate limits are generous, but one model
// should not get a burst.
const MAX_CONCURRENCY = 3;

type ItemResult = { evaluations: Evaluation[] };

/**
 * Share of the fixture's items whose gate scores all passed. Items without a
 * result, such as those Langfuse skips when their task fails, count as failed.
 */
function passRate(gates: string[], items: ItemResult[], total: number) {
  const passed = items.filter((item) =>
    gates.every((gate) =>
      item.evaluations.some((e) => e.name === gate && e.value === 1),
    ),
  ).length;
  return total === 0 ? 0 : passed / total;
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
        value: passRate(definition.gates, itemResults, fixture.items.length),
      }),
    ],
    maxConcurrency: MAX_CONCURRENCY,
  });
  console.info(await result.format({ includeItemResults: true }));
  return result.itemResults;
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
  return results;
}

/** `pnpm evals draft|calibrate <criterion>`, on the traces in Langfuse. */
async function runJudgeCommand(command: "draft" | "calibrate", args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { limit: { type: "string" } },
  });
  const [criterion] = positionals;
  if (!criterion || positionals.length > 1) {
    throw new Error(
      "Usage: pnpm evals draft <criterion> [--limit N] | pnpm evals calibrate <criterion>",
    );
  }
  const limit = Number(values.limit ?? DEFAULT_DRAFT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive whole number: ${values.limit}`);
  }
  if (!isLangfuseConfigured()) {
    throw new Error(
      `pnpm evals ${command} reads traces from Langfuse: set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.`,
    );
  }
  const rubric = await loadRubric(criterion);

  const tracing = startTracing();
  const client = new LangfuseClient();
  const deps: JudgeCommandDeps = {
    langfuse: createEvalLangfuse(client),
    judge: guardQuota((model, rubric, transcript) =>
      judgeReply(
        model ? aiTaskCandidate("judge", model) : aiTask("judge"),
        rubric,
        transcript,
      ),
    ),
    log: (line) => console.info(line),
  };
  try {
    if (command === "draft") {
      await draft(deps, { criterion, rubric, limit });
    } else {
      await calibrate(deps, {
        criterion,
        rubric,
        candidates: AI_TASKS.judge.candidates,
      });
    }
  } finally {
    await client.flush();
    await tracing?.shutdown();
  }
}

async function main() {
  if (process.env.CI) {
    throw new Error("Evals make real model calls and must not run in CI.");
  }

  const [command, ...args] = process.argv.slice(2);
  if (command === "draft" || command === "calibrate") {
    return runJudgeCommand(command, args);
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
  ).map(withQuotaGuard);

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
      const items = langfuse
        ? await runWithLangfuse(langfuse, definition, fixture)
        : await runLocally(definition, fixture);
      if (isQuotaExhausted()) throw new QuotaExhaustedError();

      if (definition.aggregate) {
        const { passed, summary } = definition.aggregate(items);
        console.info(`\n${passed ? "✓ passed" : "✗ failed"}: ${summary}`);
        failed ||= !passed;
        continue;
      }
      const rate = passRate(definition.gates, items, fixture.items.length);
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
  console.error(error instanceof QuotaExhaustedError ? error.message : error);
  process.exitCode = 1;
});
