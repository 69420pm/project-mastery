import { FatalError } from "workflow";

/**
 * Example durable workflow: the pattern for background jobs such as
 * ingestion (ARCHITECTURE decision 9). Start it with `start()` from
 * `workflow/api` in a route handler or Server Action, never by calling it.
 *
 * - The workflow function only orchestrates. It is replayed from its event
 *   log, so it must be deterministic: no I/O, no `Date.now()`, no randomness.
 * - Every side effect runs in a step. A step that throws is retried (3 times
 *   by default, `step.maxRetries` to change it); `FatalError` stops retries
 *   and `RetryableError` sets the delay, e.g. after a `429`.
 * - Progress is reported through a step, so the UI can show it.
 */
export async function exampleWorkflow(input: ExampleInput) {
  "use workflow";

  const results: ItemResult[] = [];
  for (const [index, item] of input.items.entries()) {
    results.push(await processItem(item));
    await reportProgress(input.jobId, {
      done: index + 1,
      total: input.items.length,
    });
  }
  return { jobId: input.jobId, results };
}

export type ExampleInput = { jobId: string; items: string[] };
export type ItemResult = { item: string; words: number };
export type Progress = { done: number; total: number };

/** One unit of work, e.g. converting one page. Arguments must be serializable. */
export async function processItem(item: string): Promise<ItemResult> {
  "use step";

  const text = item.trim();
  if (text === "") {
    // Retrying cannot fix bad input.
    throw new FatalError("Cannot process an empty item");
  }
  return { item: text, words: text.split(/\s+/).length };
}
processItem.maxRetries = 5;

export async function reportProgress(jobId: string, progress: Progress) {
  "use step";

  // TODO(db): write progress to the job's row once Supabase lands, so the UI
  // can show it (decision 9). Until then, progress goes to the server log.
  console.info(`[job ${jobId}] ${progress.done}/${progress.total} items`);
}
