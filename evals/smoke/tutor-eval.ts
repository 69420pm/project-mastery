/**
 * Tutoring scenarios (`evals/tutor/scenarios/`), run by hand or by an agent
 * that plays the Student and judges the replies (#277):
 *
 *   pnpm tutor-eval start <scenario>        a new Student on the gold course, set up as the scenario says
 *   pnpm tutor-eval say <run> "<message>"   the Student's message through the real Chat handler
 *   pnpm tutor-eval end <run>               deletes the run's Student with its data
 *
 * A run is one Chat; its id is the run id. After each reply `say` prints its
 * text, the tool calls with their inputs and results, and the new Attempts.
 * Local database only. Replies run on meta/muse-ember and need
 * ALLOW_LIVE_AI=1 (docs/agents/live-ai.md), unless AI_PROVIDER=mock.
 */
// Must come first: lets the runner import modules that use Next.js.
import "../next-aliases";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient, signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { insertRows, seedGoldCourse } from "./gold-course";
import { paceModelRequests } from "./pace";
import { createStudent, deleteStudent } from "./student";
import { sendMessage } from "./tutor";
import { parseScenario, setupRows, type ScenarioSetup } from "./tutor-scenario";

const SCENARIO_DIR = "evals/tutor/scenarios";

/** The model the scenarios tune the tutor for (#277). */
const MODEL = "meta/muse-ember";

/** The longest tool result printed in full; longer ones are cut. */
const MAX_RESULT_CHARS = 3000;

function assertLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      `pnpm tutor-eval works on the local database only, not ${url}`,
    );
  }
}

/** Pins the Chat to MODEL; a live reply needs ALLOW_LIVE_AI=1. */
function prepareModel() {
  if (process.env.CI) {
    throw new Error(
      "Tutoring scenarios call a real model and never run in CI.",
    );
  }
  process.env.AI_MODEL_CHAT = MODEL;
  if ((process.env.AI_PROVIDER ?? "gateway") === "mock") return;
  if (process.env.ALLOW_LIVE_AI !== "1") {
    throw new Error(
      `A reply calls ${MODEL}: prefix ALLOW_LIVE_AI=1 when live calls are allowed (docs/agents/live-ai.md), or set AI_PROVIDER=mock.`,
    );
  }
  paceModelRequests();
}

/** The scenario file named `name`, or by its number prefix, such as "03". */
async function scenarioFile(name: string) {
  const files = (await readdir(SCENARIO_DIR)).filter((f) => f.endsWith(".md"));
  const file = files.find(
    (f) => f === name || f === `${name}.md` || f.startsWith(`${name}-`),
  );
  if (!file) {
    throw new Error(
      `No scenario "${name}". Available:\n${files.map((f) => `  ${f.slice(0, -3)}`).join("\n")}`,
    );
  }
  return path.join(SCENARIO_DIR, file);
}

async function start(name: string) {
  const file = await scenarioFile(name);
  const setup = parseScenario(await readFile(file, "utf8"));
  const supabase = createAdminClient();
  const studentId = await createStudent(supabase, "tutor-eval");
  try {
    await setUp(supabase, studentId, file, setup);
  } catch (error) {
    // A half-made run is no use: leave nothing behind.
    await deleteStudent(supabase, studentId);
    throw error;
  }
}

async function setUp(
  supabase: AdminSupabase,
  studentId: string,
  file: string,
  setup: ScenarioSetup,
) {
  const gold = await seedGoldCourse(supabase, studentId, setup.examInDays);

  // The Chat exists before its first message, so the setup can put a
  // Question in its session. The trigger starts the session.
  const chatId = randomUUID();
  await insertRows(supabase, "chats", [
    { id: chatId, owner: studentId, course_id: gold.courseId },
  ]);
  const { data: session, error } = await supabase
    .from("study_sessions")
    .select("id")
    .eq("chat_id", chatId)
    .single();
  if (error) throw new Error(`study_sessions: ${error.message}`);

  const plan = setupRows(
    gold,
    setup,
    { studentId, chatId, sessionId: session.id },
    new Date(),
  );
  if (plan.goal) {
    const { error: goalError } = await supabase
      .from("briefs")
      .update({ goal: plan.goal })
      .eq("course_id", gold.courseId);
    if (goalError) throw new Error(`briefs: ${goalError.message}`);
  }
  for (const { table, rows } of plan.inserts) {
    await insertRows(supabase, table, rows);
  }
  if (plan.sessionMockId) {
    const { error: mockError } = await supabase
      .from("study_sessions")
      .update({ mock_id: plan.sessionMockId })
      .eq("id", session.id);
    if (mockError) throw new Error(`study_sessions: ${mockError.message}`);
  }

  const counts = plan.inserts
    .map(({ table, rows }) => `${table} ${rows.length}`)
    .join(", ");
  console.info(
    `Run ${chatId}: ${path.basename(file, ".md")}, exam in ${setup.examInDays} days${plan.goal ? `, goal ${plan.goal}` : ""}; set up ${counts || "nothing"}.`,
  );
  if (setup.openQuestion) {
    console.info(
      `Open Question: ${setup.openQuestion.leadIn} / ${setup.openQuestion.prompt ?? setup.openQuestion.exercise}`,
    );
  }
  console.info(`Next: pnpm tutor-eval say ${chatId} "<message>"`);
}

/** The run's Chat: its Student and Course. */
async function loadRun(supabase: AdminSupabase, run: string) {
  const { data, error } = await supabase
    .from("chats")
    .select("owner, course_id")
    .eq("id", run)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(`No run ${run}: start one with pnpm tutor-eval start.`);
  return data;
}

function shown(value: unknown) {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)} … (${text.length} chars)`
    : text;
}

async function say(run: string, message: string) {
  const supabase = createAdminClient();
  const { owner, course_id: courseId } = await loadRun(supabase, run);
  const client = await signInAsUser(supabase, owner);
  const before = new Date().toISOString();
  const reply = await sendMessage(
    client,
    owner,
    { chatId: run, courseId },
    message,
    () => {},
  );

  console.info(`AI:\n${reply.text.trim() || "(no text)"}\n`);
  console.info("Tool calls:");
  if (reply.calls.length === 0) console.info("  none");
  reply.calls.forEach((call, index) => {
    console.info(`  ${index + 1}. ${call.toolName} ${shown(call.input)}`);
    console.info(
      call.error === undefined
        ? `     → ${shown(call.output)}`
        : `     ✗ ${call.error}`,
    );
  });

  const { data: attempts, error } = await supabase
    .from("attempts")
    .select('result, help, "check", kcs(name), questions(prompt)')
    .eq("owner", owner)
    .gt("created_at", before)
    .order("created_at");
  if (error) throw new Error(error.message);
  console.info("\nNew Attempts:");
  if (attempts.length === 0) console.info("  none");
  for (const attempt of attempts) {
    console.info(
      `  ${attempt.kcs.name}: ${attempt.result}, help ${attempt.help}${attempt.check ? `, check ${attempt.check}` : ""}`,
    );
  }
}

async function end(run: string) {
  const supabase = createAdminClient();
  const { owner } = await loadRun(supabase, run);
  await deleteStudent(supabase, owner);
  console.info(`Deleted the Student of run ${run}.`);
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  assertLocal();
  if (command === "start" && first) return start(first);
  if (command === "say" && first && second) {
    prepareModel();
    return say(first, second);
  }
  if (command === "end" && first) return end(first);
  throw new Error(
    'Usage: pnpm tutor-eval start <scenario> | say <run> "<message>" | end <run>',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
