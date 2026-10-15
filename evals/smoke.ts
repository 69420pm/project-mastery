/**
 * Runs one smoke check on demand (docs/agents/live-ai.md):
 *
 *   pnpm smoke <name> [args]
 *
 * A smoke check runs one real feature path once, on a small input, against
 * the local Supabase and a real model, and checks the feature's invariants.
 * The runner pins every generating task to SMOKE_MODEL, gives the check a
 * throwaway Student, holds the Student's recorded AI calls to the check's cap (30 by default) and
 * deletes the Student with all its data afterwards. Smoke checks never run in
 * `pnpm check`, Vitest or CI.
 */
// Must come first: lets smoke checks import modules that use Next.js.
import "./next-aliases";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import { briefSmoke } from "./smoke/brief";
import { mapSmoke } from "./smoke/map";
import { parseSmoke } from "./smoke/parse";
import { prioritySmoke } from "./smoke/priority";
import type { SmokeCheck, SmokeResult } from "./smoke/smoke-check";

// Register each smoke check here; its code is `evals/smoke/<name>.ts`.
const CHECKS: SmokeCheck[] = [parseSmoke, mapSmoke, briefSmoke, prioritySmoke];

/** The model agents call (docs/agents/live-ai.md). */
const SMOKE_MODEL = "xiaomi/mimo-v2.6-flash";

/** The most model calls a smoke check may record, unless it sets its own. */
const DEFAULT_MAX_CALLS = 30;

/** Tasks whose model generates text; embeddings keep their own model. */
const GENERATING_TASK_OVERRIDES = [
  "AI_MODEL_CHAT",
  "AI_MODEL_BRIEF",
  "AI_MODEL_TITLE",
  "AI_MODEL_INGEST",
  "AI_MODEL_MAP",
  "AI_MODEL_EXERCISE",
  "AI_MODEL_PRIORITY",
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
    (row) => row.task !== "embed" && row.model_id !== SMOKE_MODEL,
  );
  return [
    {
      name: `at most ${maxCalls} model calls`,
      ok: data.length <= maxCalls,
      detail: `${data.length}: ${byTask.join(", ") || "none"}; $${cost.toFixed(5)}`,
    },
    {
      name: `generating calls answered by ${SMOKE_MODEL}`,
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
  for (const override of GENERATING_TASK_OVERRIDES) {
    process.env[override] = SMOKE_MODEL;
  }

  const supabase = createAdminClient();
  const studentId = await createStudent(supabase);
  let results: SmokeResult[];
  try {
    results = await check.run({ supabase, studentId, args });
    results.push(
      ...(await checkCalls(
        supabase,
        studentId,
        check.maxCalls ?? DEFAULT_MAX_CALLS,
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
