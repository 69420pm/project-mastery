import "server-only";
import { spawn } from "node:child_process";

/**
 * The math runner (#183): evaluates a mathjs program, one assignment per
 * line with units inline, in its own process under a time limit, and returns
 * every assigned variable's value. `compute` and the generated Problems'
 * programs run through `MathRunner`, so a sandbox can replace the process
 * later. The failure rules are in `docs/agents/notes/mathjs-programs.md`.
 */

/** The longest program run. */
export const MAX_PROGRAM_LENGTH = 4_000;

/** How long a program may run once mathjs has loaded in its worker. */
export const RUN_TIME_LIMIT_MS = 2_000;

/** How long a process may take to load mathjs before the run fails. */
const START_LIMIT_MS = 20_000;

/** The runner process's heap, beyond which it dies and the run fails. */
const MAX_HEAP_MB = 256;

/** A final answer a program declares: its variable and the unit it is in. */
export type DeclaredAnswer = {
  variable: string;
  /** A mathjs unit such as "kN" or "m/s^2"; null for a plain number. */
  unit: string | null;
};

/** An assigned variable's value as the runner returns it. */
export type ProgramValue = {
  /** The number in `unit`; null for a value that is no number or quantity. */
  value: number | null;
  /** Its unit; null for a plain number. */
  unit: string | null;
  /** The value as mathjs prints it, such as "22.5 kN" or "[1, 2]". */
  text: string;
};

/** A declared final answer's value, in its declared unit. */
export type AnswerValue = DeclaredAnswer & { value: number };

/** A run's outcome: the values, or the error that failed it. */
export type ProgramRun =
  | {
      ok: true;
      /** Every assigned variable but functions, by name. */
      values: Record<string, ProgramValue>;
      /** The declared final answers, in the order given. */
      answers: AnswerValue[];
    }
  | { ok: false; error: string };

/** Runs a program, checking its declared final answers. */
export type MathRunner = {
  run: (program: string, answers?: DeclaredAnswer[]) => Promise<ProgramRun>;
};

/**
 * The runner process's source, as CommonJS passed to `node -e` so it loads
 * the same under Next.js, Vitest and the evals: it sends `ready` once mathjs
 * has loaded, takes one program, and sends the run's result. Every failure
 * rule but the length and time limits is here.
 */
const RUNNER_SOURCE = String.raw`
const math = require("mathjs");
process.send({ type: "ready" });
const done = (result) => process.send({ type: "done", result });
const fail = (error) => done({ ok: false, error });
const text = (value) => math.format(value, { precision: 14 });
const list = (names) => names.join(", ");

function run({ program, answers }) {
  const node = math.parse(program);
  const shadowing = new Set();
  node.traverse((n) => {
    if (n.type !== "AssignmentNode" && n.type !== "FunctionAssignmentNode") return;
    for (const name of [n.name, ...(n.params ?? [])]) {
      if (typeof name === "string" && math.Unit.isValuelessUnit(name)) shadowing.add(name);
    }
  });
  if (shadowing.size > 0) {
    return fail("These variable names are mathjs units, which they would shadow: " + list([...shadowing]) + ". Rename them, such as mass_flow for m.");
  }
  const scope = new Map();
  node.compile().evaluate(scope);
  const values = {};
  const infinite = [];
  for (const [name, value] of scope) {
    if (typeof value === "function") continue;
    if (typeof value === "number") {
      values[name] = { value, unit: null, text: text(value) };
      if (!Number.isFinite(value)) infinite.push(name);
    } else if (math.isUnit(value)) {
      const number = value.value === null ? null : value.toNumber();
      values[name] = { value: number, unit: value.formatUnits() || null, text: text(value) };
      if (number !== null && !Number.isFinite(number)) infinite.push(name);
    } else {
      values[name] = { value: null, unit: null, text: text(value) };
    }
  }
  if (infinite.length > 0) {
    return fail("These variables are not finite: " + list(infinite.map((n) => n + " = " + values[n].text)) + ". Check for a division by zero or an overflow.");
  }
  const results = [];
  for (const { variable, unit } of answers) {
    const value = scope.get(variable);
    if (value === undefined || typeof value === "function") {
      return fail("The final answer " + variable + " is not assigned in the program.");
    }
    const shown = variable + " = " + text(value);
    if (unit === null) {
      if (typeof value !== "number") return fail(shown + " is declared without a unit, so it must be a plain number.");
      results.push({ variable, unit, value });
      continue;
    }
    let target;
    try {
      target = math.unit(unit);
    } catch {
      return fail("The final answer " + variable + " is declared in " + unit + ", which is no mathjs unit.");
    }
    if (!math.isUnit(value) || value.value === null || !value.equalBase(target)) {
      return fail(shown + " is no quantity in " + unit + ": it must carry a unit convertible to " + unit + ". Dividing by a unit, as in x / 1000 N, drops it.");
    }
    results.push({ variable, unit, value: value.toNumber(unit) });
  }
  done({ ok: true, values, answers: results });
}

process.once("message", (input) => {
  try {
    run(input);
  } catch (error) {
    fail("The program failed: " + (error instanceof Error ? error.message : String(error)));
  }
});
`;

const failed = (error: string): ProgramRun => ({ ok: false, error });

type RunnerMessage = { type: "ready" } | { type: "done"; result: ProgramRun };

/**
 * Runs a program in a new Node process, killed after the time limit. A
 * process, not a worker thread: a worker's heap limits don't stop a large
 * allocation such as `range(1, 1e8)`, whose out-of-memory error aborts the
 * whole server, while a process only takes itself down.
 */
function runInProcess(
  program: string,
  answers: DeclaredAnswer[] = [],
): Promise<ProgramRun> {
  if (program.length > MAX_PROGRAM_LENGTH) {
    return Promise.resolve(
      failed(
        `The program has ${program.length} characters, more than the ${MAX_PROGRAM_LENGTH} allowed.`,
      ),
    );
  }
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${MAX_HEAP_MB}`, "-e", RUNNER_SOURCE],
      // No environment, so a program can never reach the server's secrets.
      {
        env: { NODE_ENV: "production" },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (run: ProgramRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(run);
    };
    timer = setTimeout(
      () => finish(failed("The math runner did not start.")),
      START_LIMIT_MS,
    );
    child.on("message", (message: RunnerMessage) => {
      if (message.type === "done") return finish(message.result);
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          finish(
            failed(
              `The program ran longer than ${RUN_TIME_LIMIT_MS / 1000} s and was stopped.`,
            ),
          ),
        RUN_TIME_LIMIT_MS,
      );
      child.send({ program, answers });
    });
    child.on("error", (error) =>
      finish(failed(`The math runner failed: ${error.message}`)),
    );
    child.on("exit", () =>
      finish(
        failed(
          "The program stopped without a result: it may have run out of memory.",
        ),
      ),
    );
  });
}

/** The runner that evaluates programs in a Node process each. */
export const mathRunner: MathRunner = { run: runInProcess };
