/**
 * Runs one smoke check on demand (docs/agents/live-ai.md):
 *
 *   pnpm smoke <name> [args]
 *
 * A smoke check runs one real feature path once, on a small input, against
 * the local Supabase and a real model, and checks the feature's invariants.
 * The runner pins every generating task to the check's model or
 * DEFAULT_SMOKE_MODEL (see below), gives the
 * check a throwaway Student, holds the Student's recorded AI calls to the
 * check's cap (30 by default), stops it after MAX_MINUTES and deletes the
 * Student with all its data afterwards. Smoke checks never run in
 * `pnpm check`, Vitest or CI.
 */
// Must come first: lets smoke checks import modules that use Next.js.
import "./next-aliases";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import { briefSmoke } from "./smoke/brief";
import { closeSmoke } from "./smoke/close";
import { generateSmoke } from "./smoke/generate";
import { gradeMockSmoke } from "./smoke/grade-mock";
import { mapFindingsSmoke } from "./smoke/map-findings";
import { mockSmoke } from "./smoke/mock";
import { pairSmoke } from "./smoke/pair";
import { parseSmoke } from "./smoke/parse";
import { reviewSmoke } from "./smoke/review";
import { result, type SmokeCheck, type SmokeResult } from "./smoke/smoke-check";
import { tutorSmoke } from "./smoke/tutor";

// Register each smoke check here; its code is `evals/smoke/<name>.ts`.
const CHECKS: SmokeCheck[] = [
  parseSmoke,
  pairSmoke,
  briefSmoke,
  tutorSmoke,
  mapFindingsSmoke,
  generateSmoke,
  reviewSmoke,
  mockSmoke,
  gradeMockSmoke,
  closeSmoke,
];

/**
 * The model every generating task is pinned to unless the check names its
 * own (docs/agents/live-ai.md). With a Google key, as in local development,
 * that is the Gemini model, which answers in seconds where MiMo through
 * DeepInfra can take minutes (ADR 0016). `AI_SMOKE_MODEL` pins another
 * model, such as xiaomi/mimo-v2.6-flash, the model that ships.
 */
const DEFAULT_SMOKE_MODEL =
  process.env.AI_SMOKE_MODEL ??
  (process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? "google/gemini-3.5-flash-lite"
    : "xiaomi/mimo-v2.6-flash");

/** The most model calls a smoke check may record, unless it sets its own. */
const DEFAULT_MAX_CALLS = 30;

/**
 * How long a check may run. An agent's prompt cache expires after 5 idle
 * minutes, so a longer wait makes it write its whole context again
 * (docs/agents/live-ai.md). `AI_SMOKE_MAX_MINUTES` sets another limit, such
 * as for a check on MiMo.
 */
const MAX_MINUTES = Number(process.env.AI_SMOKE_MAX_MINUTES || 4);

const timedOut = Symbol("timed out");

/** The check's results, or `timedOut` once MAX_MINUTES have passed. */
async function withinTimeLimit(run: Promise<SmokeResult[]>) {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), MAX_MINUTES * 60_000);
  });
  try {
    return await Promise.race([run, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Gemini free tier's limit: 15 requests per minute (`notes/ai-sdk.md`).
 * The AI SDK's retries don't wait a 429 out, and a reply of several steps
 * makes several requests, so the runner holds each Gemini request until the
 * last minute has room for it. `AI_SMOKE_RPM` sets another limit.
 */
const GEMINI_RPM = Number(process.env.AI_SMOKE_RPM || 14);

/** Whether `url` is a Gemini API request; false for a non-URL. */
function isGeminiApi(url: string) {
  try {
    return new URL(url).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

/** Wraps `fetch` so Gemini API requests keep within GEMINI_RPM. */
function paceGeminiRequests() {
  const sent: number[] = [];
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isGeminiApi(url)) {
      for (;;) {
        const now = Date.now();
        while (sent.length > 0 && sent[0]! <= now - 60_000) sent.shift();
        if (sent.length < GEMINI_RPM) break;
        await new Promise((resolve) =>
          setTimeout(resolve, sent[0]! + 60_000 - now + 100),
        );
      }
      sent.push(Date.now());
    }
    return fetch(input, init);
  };
}

/** Tasks whose model generates text; embeddings keep their own model. */
const GENERATING_TASK_OVERRIDES = [
  "AI_MODEL_CHAT",
  "AI_MODEL_BRIEF",
  "AI_MODEL_TITLE",
  "AI_MODEL_INGEST",
  "AI_MODEL_MAP",
  "AI_MODEL_EXERCISE",
  "AI_MODEL_TOPIC",
  "AI_MODEL_GENERATE",
  "AI_MODEL_GRADE_EXAM",
  "AI_MODEL_CLOSE",
  "AI_MODEL_JUDGE",
];

/** A Student no one signs in as, owning everything the check stores. */
async function createStudent(supabase: AdminSupabase) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `smoke-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error)
    throw new Error(`Creating the smoke Student failed: ${error.message}`);
  return data.user.id;
}

/** Deletes the Student's files, then the Student, whose rows cascade. */
async function deleteStudent(supabase: AdminSupabase, studentId: string) {
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  const { data: courses } = await bucket.list(studentId);
  for (const course of courses ?? []) {
    const { data: files } = await bucket.list(`${studentId}/${course.name}`);
    const paths = (files ?? []).map(
      (f) => `${studentId}/${course.name}/${f.name}`,
    );
    if (paths.length > 0) await bucket.remove(paths);
  }
  const { error } = await supabase.auth.admin.deleteUser(studentId);
  if (error)
    console.error(`Deleting the smoke Student failed: ${error.message}`);
}

/** The model calls the Student's run recorded, against the cap and model. */
async function checkCalls(
  supabase: AdminSupabase,
  studentId: string,
  maxCalls: number,
  model: string,
): Promise<SmokeResult[]> {
  const { data, error } = await supabase
    .from("ai_usage")
    .select("task, model_id, cost_usd")
    .eq("owner", studentId);
  if (error) throw new Error(error.message);
  const byTask = Object.entries(
    Object.groupBy(data, (row) => `${row.task} ${row.model_id}`),
  ).map(([key, rows]) => `${key} ×${rows?.length}`);
  const cost = data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
  const offModel = data.filter(
    (row) => row.task !== "embed" && row.model_id !== model,
  );
  return [
    {
      name: `at most ${maxCalls} model calls`,
      ok: data.length <= maxCalls,
      detail: `${data.length}: ${byTask.join(", ") || "none"}; $${cost.toFixed(5)}`,
    },
    {
      name: `generating calls answered by ${model}`,
      ok: offModel.length === 0,
      ...(offModel.length > 0
        ? { detail: offModel.map((row) => row.model_id).join(", ") }
        : {}),
    },
  ];
}

async function main() {
  if (process.env.CI) {
    throw new Error(
      "Smoke checks make real model calls and must not run in CI.",
    );
  }
  const [name, ...args] = process.argv.slice(2);
  const check = CHECKS.find((c) => c.name === name);
  if (!check) {
    throw new Error(
      `Usage: pnpm smoke <name> [args]. Available:\n${CHECKS.map((c) => `  ${c.usage}`).join("\n")}`,
    );
  }
  if ((process.env.AI_PROVIDER ?? "gateway") === "mock") {
    throw new Error("Smoke checks need a real model: unset AI_PROVIDER=mock.");
  }
  const model = check.model ?? DEFAULT_SMOKE_MODEL;
  for (const override of GENERATING_TASK_OVERRIDES) {
    process.env[override] = model;
  }
  paceGeminiRequests();

  const supabase = createAdminClient();
  const studentId = await createStudent(supabase);
  let results: SmokeResult[];
  let stopped = false;
  try {
    const outcome = await withinTimeLimit(
      check.run({ supabase, studentId, args }),
    );
    stopped = outcome === timedOut;
    results =
      outcome === timedOut
        ? [
            result(
              `finished within ${MAX_MINUTES} min`,
              false,
              "stopped, so the feature path is not verified; a model call was slow, see the calls below",
            ),
          ]
        : outcome;
    results.push(
      ...(await checkCalls(
        supabase,
        studentId,
        check.maxCalls ?? DEFAULT_MAX_CALLS,
        model,
      )),
    );
  } finally {
    await deleteStudent(supabase, studentId);
  }

  console.info();
  for (const { name: invariant, ok, detail } of results) {
    console.info(
      `${ok ? "✓" : "✗"} ${invariant}${detail ? `: ${detail}` : ""}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.info(
    failed === 0
      ? `\n✓ smoke ${check.name} passed`
      : `\n✗ smoke ${check.name}: ${failed} failed`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
  // A stopped check's model call still holds the process open.
  if (stopped) process.exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
