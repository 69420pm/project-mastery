/**
 * `pnpm evals draft` and `pnpm evals calibrate`: drafting a judge criterion's
 * labels on traced Chat replies for the maintainer to correct, and measuring
 * how well each judge candidate agrees with the corrected labels.
 */
import { QuotaExhaustedError } from "./eval";
import { chatTranscript, type ChatTranscript, type Verdict } from "./judge";
import type { EvalLangfuse } from "./langfuse";

/** The annotation queue the maintainer labels judge criteria in. */
export const CRITERIA_QUEUE = "tutor-criteria";

export const DEFAULT_DRAFT_LIMIT = 20;

export type JudgeCommandDeps = {
  langfuse: EvalLangfuse;
  /**
   * One judge call, on `model` or, when undefined, on the `judge` task's
   * configured model.
   */
  judge: (
    model: string | undefined,
    rubric: string,
    transcript: ChatTranscript,
  ) => Promise<Verdict>;
  log: (line: string) => void;
};

type Criterion = { criterion: string; rubric: string };

/** A failed judge call is reported and skipped; a used-up quota stops all. */
async function tryJudge(
  deps: JudgeCommandDeps,
  model: string | undefined,
  rubric: string,
  transcript: ChatTranscript,
  traceId: string,
): Promise<Verdict | undefined> {
  try {
    return await deps.judge(model, rubric, transcript);
  } catch (error) {
    if (error instanceof QuotaExhaustedError) throw error;
    deps.log(`  ! ${traceId}: the judge failed: ${String(error)}`);
    return undefined;
  }
}

/**
 * Judges up to `limit` recent Chat replies that are not in the queue yet,
 * writes each verdict as a `<criterion>_draft` score with the reason as its
 * comment, and adds the trace to the queue. Returns how many were drafted.
 */
export async function draft(
  deps: JudgeCommandDeps,
  { criterion, rubric, limit }: Criterion & { limit: number },
): Promise<number> {
  const { langfuse, log } = deps;
  const queueId = await langfuse.annotationQueueId(CRITERIA_QUEUE);
  if (!queueId) {
    throw new Error(
      `Langfuse has no annotation queue "${CRITERIA_QUEUE}". Create it in the Langfuse UI first (issue #172, Shipping).`,
    );
  }
  const queued = await langfuse.queuedTraceIds(queueId);
  const traces = await langfuse.chatReplies({ limit, exclude: queued });

  let drafted = 0;
  for (const trace of traces) {
    const transcript = chatTranscript(trace);
    if (!transcript) {
      log(`  - ${trace.traceId}: no reply text, skipped`);
      continue;
    }
    const verdict = await tryJudge(
      deps,
      undefined,
      rubric,
      transcript,
      trace.traceId,
    );
    if (!verdict) continue;
    await langfuse.writeTraceScore({
      traceId: trace.traceId,
      name: `${criterion}_draft`,
      pass: verdict.pass,
      comment: verdict.reason,
    });
    await langfuse.addToQueue(queueId, trace.traceId);
    drafted++;
    log(`  ${verdict.pass ? "✓" : "✗"} ${trace.traceId}: ${verdict.reason}`);
  }
  log(
    `Drafted ${criterion} on ${drafted} of ${traces.length} new traces and queued them in ${CRITERIA_QUEUE}.`,
  );
  return drafted;
}

export type CandidateResult = {
  model: string;
  /** Traces where the candidate's verdict matched the human label. */
  agreed: number;
  /** Labelled traces judged, failed calls included. */
  count: number;
  /** Judge calls that failed; they count as disagreement. */
  failed: number;
};

/** The share of labels a candidate's verdicts match; a missing verdict misses. */
export function agreement(
  model: string,
  labels: boolean[],
  verdicts: (boolean | undefined)[],
): CandidateResult {
  return {
    model,
    agreed: labels.filter((label, index) => verdicts[index] === label).length,
    count: labels.length,
    failed: verdicts.filter((verdict) => verdict === undefined).length,
  };
}

const rate = ({ agreed, count }: CandidateResult) =>
  count === 0 ? 0 : agreed / count;

/**
 * The candidate with the highest agreement. On a tie, the one listed first
 * wins: the `judge` task lists its candidates in tie-break order.
 */
export function pickWinner(results: CandidateResult[]): CandidateResult {
  return results.reduce((best, result) =>
    rate(result) > rate(best) ? result : best,
  );
}

/**
 * Runs every candidate on the traces with a human `<criterion>` score and
 * prints each one's agreement and the winner. Changes no configuration.
 */
export async function calibrate(
  deps: JudgeCommandDeps,
  {
    criterion,
    rubric,
    candidates,
  }: Criterion & { candidates: readonly string[] },
): Promise<CandidateResult> {
  const { langfuse, log } = deps;
  // A trace labelled twice keeps its latest label.
  const labels = new Map(
    (await langfuse.annotationScores(criterion)).map((score) => [
      score.traceId,
      score.value,
    ]),
  );
  if (labels.size === 0) {
    throw new Error(
      `No trace has a human "${criterion}" score yet. Label traces in the "${CRITERIA_QUEUE}" annotation queue first.`,
    );
  }

  const cases: {
    traceId: string;
    label: boolean;
    transcript: ChatTranscript;
  }[] = [];
  for (const [traceId, label] of labels) {
    const trace = await langfuse.chatReply(traceId);
    const transcript = trace && chatTranscript(trace);
    if (transcript) cases.push({ traceId, label, transcript });
    else log(`  - ${traceId}: no Chat reply found, skipped`);
  }
  if (cases.length === 0) {
    throw new Error(`No labelled "${criterion}" trace has a Chat reply.`);
  }

  const results: CandidateResult[] = [];
  for (const model of candidates) {
    const verdicts: (boolean | undefined)[] = [];
    for (const { traceId, transcript } of cases) {
      const verdict = await tryJudge(deps, model, rubric, transcript, traceId);
      verdicts.push(verdict?.pass);
    }
    results.push(
      agreement(
        model,
        cases.map(({ label }) => label),
        verdicts,
      ),
    );
  }

  log(`${criterion}: ${cases.length} traces with a human label`);
  for (const result of results) {
    const failed = result.failed > 0 ? `, ${result.failed} failed` : "";
    log(
      `  ${result.model}: agreement ${rate(result).toFixed(2)} (${result.agreed}/${result.count}${failed})`,
    );
  }
  const winner = pickWinner(results);
  log(`Winner: ${winner.model}`);
  return winner;
}
