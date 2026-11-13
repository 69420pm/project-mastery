/**
 * Brief scenarios (`evals/brief/scenarios/`), run by an agent that plays
 * the Student and judges the replies (#279):
 *
 *   pnpm brief-eval start <scenario> --course A|B   a new Student with Course A (gold) or B (small), the Brief set up as the scenario says
 *   pnpm brief-eval say <run> "<message>"           the Student's message through the real Brief handler
 *   pnpm brief-eval end <run>                       deletes the run's Student with its data
 *
 * A run is one Course's Brief; its id is the Course's. After each reply
 * `say` prints its text, the tool calls with their inputs and results, and
 * the stored Brief. Local database only. Replies run on meta/muse-ember and
 * need ALLOW_LIVE_AI=1 (docs/agents/live-ai.md), unless AI_PROVIDER=mock.
 */
// Must come first: lets the runner import modules that use Next.js.
import "../next-aliases";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openBrief } from "@/features/brief/server";
import { createAdminClient, signInAsUser } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { seedSmallCourse } from "./brief-course";
import { parseScenario, briefSetup } from "./brief-scenario";
import { sendBriefMessage } from "./brief-send";
import { insertRows, seedGoldCourse } from "./gold-course";
import { paceModelRequests } from "./pace";
import { createStudent, deleteStudent } from "./student";

const SCENARIO_DIR = "evals/brief/scenarios";

/** The model the scenarios tune the Brief for (#279). */
const MODEL = "meta/muse-ember";

/** Course B's name, as the Student sees it. */
const SMALL_COURSE_NAME = "Vektoren und Matrizen";

/** The longest tool result printed in full; longer ones are cut. */
const MAX_RESULT_CHARS = 3000;

function assertLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      `pnpm brief-eval works on the local database only, not ${url}`,
    );
  }
}

/** Pins the Brief to MODEL; a live reply needs ALLOW_LIVE_AI=1. */
function prepareModel() {
  if (process.env.CI) {
    throw new Error("Brief scenarios call a real model and never run in CI.");
  }
  process.env.AI_MODEL_BRIEF = MODEL;
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

function must<T>(response: {
  data: T | null;
  error: { message: string } | null;
}) {
  if (response.error) throw new Error(response.error.message);
  return response.data as T;
}

async function start(name: string, course: "A" | "B") {
  const file = await scenarioFile(name);
  const setup = parseScenario(await readFile(file, "utf8"));
  const supabase = createAdminClient();
  const studentId = await createStudent(supabase, "brief-eval");
  try {
    const courseId =
      course === "A"
        ? (await seedGoldCourse(supabase, studentId)).courseId
        : (await seedSmallCourse(supabase, studentId, SMALL_COURSE_NAME))
            .courseId;
    await setUpBrief(supabase, studentId, courseId, setup);
    const client = await signInAsUser(supabase, studentId);
    const messages = (await openBrief(client, courseId)) ?? [];
    console.info(
      `Run ${courseId}: ${path.basename(file, ".md")} on Course ${course}${setup.answered ? ", Brief already answered" : ""}.\n`,
    );
    for (const message of messages) {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      console.info(`${message.role === "user" ? "Student" : "AI"}:\n${text}\n`);
    }
    await printBrief(supabase, courseId);
    console.info(`\nNext: pnpm brief-eval say ${courseId} "<message>"`);
  } catch (error) {
    // A half-made run is no use: leave nothing behind.
    await deleteStudent(supabase, studentId);
    throw error;
  }
}

/**
 * Replaces the seeded Course's Brief with the scenario's: the gold
 * snapshot comes with a finished Brief, which a new one must not show.
 */
async function setUpBrief(
  supabase: AdminSupabase,
  studentId: string,
  courseId: string,
  setup: ReturnType<typeof parseScenario>,
) {
  const candidates = must(
    await supabase
      .from("chapters")
      .select("id")
      .eq("course_id", courseId)
      .or("is_exam.eq.true,exam_proposed.eq.true")
      .order("position"),
  );
  const plan = briefSetup(
    { courseId, studentId, examChapterIds: candidates.map((c) => c.id) },
    setup,
    new Date(),
  );
  must(
    await supabase
      .from("chapters")
      .update({ is_exam: null, exam_asked: false })
      .eq("course_id", courseId)
      .select("id"),
  );
  must(
    await supabase
      .from("chapters")
      .update({
        exam_proposed: true,
        is_exam: plan.examChapters.isExam,
        exam_asked: plan.examChapters.asked,
      })
      .in("id", plan.examChapters.ids)
      .select("id"),
  );
  for (const table of [
    "exam_scopes",
    "brief_excluded_materials",
    "brief_messages",
    "briefs",
  ] as const) {
    must(
      await supabase
        .from(table)
        .delete()
        .eq("course_id", courseId)
        .select("course_id"),
    );
  }
  await insertRows(supabase, "briefs", [plan.brief]);
}

/** The run's Course: its Student. */
async function loadRun(supabase: AdminSupabase, run: string) {
  const { data, error } = await supabase
    .from("courses")
    .select("owner")
    .eq("id", run)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(`No run ${run}: start one with pnpm brief-eval start.`);
  }
  return data.owner;
}

function shown(value: unknown) {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)} … (${text.length} chars)`
    : text;
}

/** Prints what the Brief stores, as the database holds it. */
async function printBrief(supabase: AdminSupabase, courseId: string) {
  const [brief, course, excluded, exams, scopes] = await Promise.all([
    supabase
      .from("briefs")
      .select(
        "exam_date, goal, open_book, formula_sheet, calculator, scope_confirmed, notes, reserved_exam_answered, reserved_exam_chapter_id",
      )
      .eq("course_id", courseId)
      .single(),
    supabase.from("courses").select("language").eq("id", courseId).single(),
    supabase
      .from("brief_excluded_materials")
      .select("materials(name)")
      .eq("course_id", courseId),
    supabase
      .from("chapters")
      .select("id, title, is_exam, materials(name)")
      .eq("course_id", courseId)
      .not("is_exam", "is", null)
      .order("position"),
    supabase
      .from("exam_scopes")
      .select("scope, words, topics(name)")
      .eq("course_id", courseId),
  ]);
  const b = must(brief);
  const marked = must(exams);
  const name = (chapter: (typeof marked)[number]) =>
    `${chapter.materials.name} › ${chapter.title}`;
  const reserved = marked.find((c) => c.id === b.reserved_exam_chapter_id);
  const list = (items: string[]) => (items.length ? items.join("; ") : "none");
  console.info("Stored Brief:");
  console.info(
    [
      `  exam date: ${b.exam_date}, goal: ${b.goal}`,
      `  open book: ${b.open_book}, formula sheet: ${b.formula_sheet}, calculator: ${b.calculator}`,
      `  scope confirmed: ${b.scope_confirmed}, course language: ${must(course).language}`,
      `  excluded Materials: ${list(must(excluded).map((row) => row.materials.name))}`,
      `  old exams: ${list(marked.filter((c) => c.is_exam).map(name))}`,
      `  not old exams: ${list(marked.filter((c) => !c.is_exam).map(name))}`,
      `  reserved exam: ${b.reserved_exam_answered ? (reserved ? name(reserved) : "none") : "not answered"}`,
      `  exam scopes: ${list(must(scopes).map((s) => `${s.topics.name} ${s.scope} ("${s.words}")`))}`,
      `  notes: ${b.notes ?? "none"}`,
    ].join("\n"),
  );
}

async function say(run: string, message: string) {
  const supabase = createAdminClient();
  const owner = await loadRun(supabase, run);
  const client = await signInAsUser(supabase, owner);
  const reply = await sendBriefMessage(client, owner, run, message);

  console.info(`AI:\n${reply.text || "(no text)"}\n`);
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
  for (const error of reply.errors) console.info(`Stream error: ${error}`);
  console.info("");
  await printBrief(supabase, run);
}

async function end(run: string) {
  const supabase = createAdminClient();
  await deleteStudent(supabase, await loadRun(supabase, run));
  console.info(`Deleted the Student of run ${run}.`);
}

const USAGE =
  'Usage: pnpm brief-eval start <scenario> --course A|B | say <run> "<message>" | end <run>';

async function main() {
  const [command, first, ...rest] = process.argv.slice(2);
  assertLocal();
  if (command === "start" && first) {
    const course = rest[0] === "--course" ? rest[1] : undefined;
    if (course !== "A" && course !== "B") throw new Error(USAGE);
    return start(first, course);
  }
  if (command === "say" && first && rest[0]) {
    prepareModel();
    return say(first, rest[0]);
  }
  if (command === "end" && first) return end(first);
  throw new Error(USAGE);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
