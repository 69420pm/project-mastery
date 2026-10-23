// @vitest-environment node
import { expect, test, vi } from "vitest";
import { QuotaExhaustedError } from "./eval";
import {
  agreement,
  calibrate,
  draft,
  pickWinner,
  type JudgeCommandDeps,
} from "./judge-commands";
import type { ChatReplyTrace, EvalLangfuse } from "./langfuse";

const QWEN = "alibaba/qwen3.7-flash";
const MIMO = "xiaomi/mimo-v2.6-flash";

function reply(traceId: string, text: string): ChatReplyTrace {
  return {
    traceId,
    startTime: "2026-10-23T10:00:00Z",
    input: [{ role: "user", content: "Solve 7.2b" }],
    output: text,
  };
}

function fakeLangfuse(overrides: Partial<EvalLangfuse> = {}) {
  return {
    chatReplies: vi.fn(async () => [
      reply("t1", "Try it first."),
      reply("t2", ""),
    ]),
    chatReply: vi.fn(async (traceId: string) => reply(traceId, "x = 2")),
    annotationQueueId: vi.fn(async () => "queue-1"),
    queuedTraceIds: vi.fn(async () => new Set(["t0"])),
    addToQueue: vi.fn(async () => {}),
    writeTraceScore: vi.fn(async () => {}),
    annotationScores: vi.fn(async () => []),
    ...overrides,
  } satisfies EvalLangfuse;
}

function deps(
  langfuse: EvalLangfuse,
  judge: JudgeCommandDeps["judge"] = async () => ({
    pass: true,
    reason: "Asks for an attempt.",
  }),
) {
  const lines: string[] = [];
  return { langfuse, judge, log: (line: string) => lines.push(line), lines };
}

test("agreement counts matching verdicts, and a failed call as a miss", () => {
  expect(agreement(QWEN, [true, false, true], [true, true, undefined])).toEqual(
    { model: QWEN, agreed: 1, count: 3, failed: 1 },
  );
});

test("the higher agreement wins, and a tie goes to the first candidate", () => {
  const qwen = { model: QWEN, agreed: 3, count: 4, failed: 0 };
  const mimo = { model: MIMO, agreed: 4, count: 4, failed: 0 };
  expect(pickWinner([qwen, mimo]).model).toBe(MIMO);
  expect(pickWinner([qwen, { ...mimo, agreed: 3 }]).model).toBe(QWEN);
});

test("draft scores new replies, queues them and skips replies without text", async () => {
  const langfuse = fakeLangfuse();
  const run = deps(langfuse);

  const drafted = await draft(run, {
    criterion: "attempt_before_help",
    rubric: "rubric",
    limit: 3,
  });

  expect(drafted).toBe(1);
  expect(langfuse.chatReplies).toHaveBeenCalledWith({
    limit: 3,
    exclude: new Set(["t0"]),
  });
  expect(langfuse.writeTraceScore).toHaveBeenCalledExactlyOnceWith({
    traceId: "t1",
    name: "attempt_before_help_draft",
    pass: true,
    comment: "Asks for an attempt.",
  });
  expect(langfuse.addToQueue).toHaveBeenCalledExactlyOnceWith("queue-1", "t1");
});

test("draft stops before any judge call without the queue", async () => {
  const judge = vi.fn();
  const run = deps(
    fakeLangfuse({ annotationQueueId: async () => undefined }),
    judge,
  );

  await expect(
    draft(run, { criterion: "attempt_before_help", rubric: "r", limit: 3 }),
  ).rejects.toThrow(/no annotation queue "tutor-criteria"/);
  expect(judge).not.toHaveBeenCalled();
});

test("draft stops when the quota is used up", async () => {
  const langfuse = fakeLangfuse();
  const run = deps(langfuse, async () => {
    throw new QuotaExhaustedError();
  });

  await expect(
    draft(run, { criterion: "attempt_before_help", rubric: "r", limit: 3 }),
  ).rejects.toThrow(QuotaExhaustedError);
  expect(langfuse.writeTraceScore).not.toHaveBeenCalled();
});

test("calibrate judges each labelled trace with every candidate and names the winner", async () => {
  const langfuse = fakeLangfuse({
    annotationScores: async () => [
      { traceId: "t1", value: true, timestamp: "2026-10-20T00:00:00Z" },
      { traceId: "t2", value: true, timestamp: "2026-10-21T00:00:00Z" },
      // The later label of t1 replaces the earlier one.
      { traceId: "t1", value: false, timestamp: "2026-10-22T00:00:00Z" },
    ],
    chatReply: async (traceId) =>
      reply(traceId, traceId === "t1" ? "Try it first." : "x = 2"),
  });
  // MiMo passes both; Qwen fails t1, as labelled, and errs on t2.
  const judge = vi.fn<JudgeCommandDeps["judge"]>(
    async (model, _rubric, transcript) => {
      if (model === MIMO) return { pass: true, reason: "" };
      if (transcript.reply === "x = 2") throw new Error("no object generated");
      return { pass: false, reason: "" };
    },
  );
  const run = deps(langfuse, judge);

  const winner = await calibrate(run, {
    criterion: "attempt_before_help",
    rubric: "r",
    candidates: [QWEN, MIMO],
  });

  // Qwen: t1 false (matches), t2 failed → 1/2. MiMo: t1 true, t2 true → 1/2.
  expect(winner.model).toBe(QWEN);
  expect(judge).toHaveBeenCalledTimes(4);
  expect(run.lines).toContain(`  ${QWEN}: agreement 0.50 (1/2, 1 failed)`);
  expect(run.lines).toContain(`  ${MIMO}: agreement 0.50 (1/2)`);
  expect(run.lines).toContain(`Winner: ${QWEN}`);
});

test("calibrate needs human labels", async () => {
  const judge = vi.fn();
  await expect(
    calibrate(deps(fakeLangfuse(), judge), {
      criterion: "attempt_before_help",
      rubric: "r",
      candidates: [QWEN, MIMO],
    }),
  ).rejects.toThrow(/No trace has a human "attempt_before_help" score/);
  expect(judge).not.toHaveBeenCalled();
});
