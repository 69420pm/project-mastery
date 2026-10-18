/**
 * Deterministic checks for /sweep, the ones lint doesn't cover:
 *
 *   pnpm -s sweep                   knip, jscpd, coverage and metrics per unit
 *   pnpm -s sweep mutate [unit...]  Stryker on each unit's non-React code
 *
 * Writes to .sweep/<date>/ and prints the units, then one line per file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeMetrics, formatMetrics } from "./metrics";
import { isExcluded, listFiles, listUnits, unitOf, type Unit } from "./units";
import { withoutSupabase } from "./without-supabase";

const root = process.cwd();
const units = listUnits(root);
const outDir = path.join(".sweep", new Date().toISOString().slice(0, 10));

// Each Stryker process runs its own single-worker Vitest. One per core, as
// Stryker defaults to, exhausted the VM's memory and crashed it.
const MUTATION_CONCURRENCY = 4;

/** Runs a command and resolves with its exit code and output. */
function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd: root,
      env: { ...process.env, ...env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

function save(file: string, text: string, summary: string) {
  const target = path.join(outDir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`${target}  ${summary}`);
}

async function knip() {
  const { out } = await run([
    "pnpm",
    "exec",
    "knip",
    "--no-progress",
    "--no-exit-code",
    "--no-config-hints",
  ]);
  const counts = [...out.matchAll(/^(.+) \((\d+)\)$/gm)];
  save(
    "knip.txt",
    out,
    counts.map((m) => `${m[1]!.toLowerCase()} ${m[2]}`).join(", ") ||
      "no issues",
  );
}

async function jscpd() {
  const { out } = await run(["pnpm", "exec", "jscpd"]);
  const text = out
    .split("\n")
    .filter((line) => !/^(Using config|time:)/.test(line))
    .join("\n");
  save("jscpd.txt", text, /^.*duplication.*$/m.exec(text)?.[0] ?? "");
}

type Totals = { total: number; covered: number };
type Summary = Record<string, Record<"lines" | "branches", Totals>>;

// Runs `pnpm test:coverage`'s Vitest run with its include widened: the config
// covers only src/, and the units also hold tools/ and evals/.
async function coverage() {
  const dir = path.join(outDir, "coverage");
  const { code } = await run([
    "pnpm",
    "exec",
    "vitest",
    "run",
    "--coverage",
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${dir}`,
    "--coverage.include=src/**",
    "--coverage.include=tools/**",
    "--coverage.include=evals/**",
    "--coverage.reportOnFailure",
  ]);
  const summaryPath = path.join(dir, "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    save("coverage.md", "Coverage failed: no summary written.\n", "failed");
    return;
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Summary;
  const pct = (t: Totals) =>
    t.total ? `${Math.round((100 * t.covered) / t.total)}%` : "-";
  const sum = (a: Totals, b: Totals) => ({
    total: a.total + b.total,
    covered: a.covered + b.covered,
  });
  const byUnit = new Map<string, string[]>();
  const totals = new Map<string, { lines: Totals; branches: Totals }>();
  for (const [abs, s] of Object.entries(summary)) {
    const file = path.relative(root, abs);
    const unit = abs === "total" ? undefined : unitOf(units, file);
    if (!unit || isExcluded(file)) continue;
    const t = totals.get(unit.name) ?? {
      lines: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
    };
    totals.set(unit.name, {
      lines: sum(t.lines, s.lines),
      branches: sum(t.branches, s.branches),
    });
    byUnit.set(unit.name, [
      ...(byUnit.get(unit.name) ?? []),
      `| ${file} | ${pct(s.lines)} | ${s.lines.total - s.lines.covered} | ${pct(s.branches)} |`,
    ]);
  }
  const lines = [
    "# Coverage",
    "",
    ...(code === 0
      ? []
      : ["Some tests failed; coverage is of the run as it went.", ""]),
    "| Unit | Lines | Branches |",
    "| --- | --: | --: |",
    ...units
      .filter((u) => totals.has(u.name))
      .map((u) => {
        const t = totals.get(u.name)!;
        return `| ${u.name} | ${pct(t.lines)} | ${pct(t.branches)} |`;
      }),
    ...units
      .filter((u) => byUnit.has(u.name))
      .flatMap((u) => [
        "",
        `## ${u.name}`,
        "",
        "| File | Lines | Uncovered lines | Branches |",
        "| --- | --: | --: | --: |",
        ...byUnit.get(u.name)!.sort(),
      ]),
    "",
  ];
  save(
    "coverage.md",
    lines.join("\n"),
    code === 0 ? "per unit and file" : "per unit and file; some tests failed",
  );
}

function metrics() {
  save(
    "metrics.md",
    formatMetrics(computeMetrics(root, units)),
    "LOC, exports used outside, fan-in and fan-out per unit",
  );
}

type Mutant = {
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number } };
};
type MutationReport = {
  files: Record<string, { source: string; mutants: Mutant[] }>;
};

async function mutate(unit: Unit) {
  const folders = unit.mutate.filter((f) =>
    listFiles(root, f).some((file) => /\.ts$/.test(file) && !isExcluded(file)),
  );
  const tests = unit.paths.flatMap((p) => listFiles(root, p));
  if (!folders.length || !tests.some((f) => /\.test\.tsx?$/.test(f))) {
    console.log(`${unit.name}  skipped: no code to mutate or no unit tests`);
    return;
  }
  const report = path.resolve(outDir, "mutants", `${unit.name}.json`);
  const { code, out } = await run(
    ["pnpm", "exec", "stryker", "run", "stryker.config.mjs"],
    {
      SWEEP_MUTATE: folders.map((f) => `${f}/**/*.ts`).join(","),
      SWEEP_TESTS: unit.paths.join(" "),
      SWEEP_CONCURRENCY: String(MUTATION_CONCURRENCY),
      SWEEP_REPORT: report,
    },
  );
  if (code !== 0 || !existsSync(report)) {
    save(`mutants/${unit.name}.md`, out, `Stryker failed (exit ${code})`);
    return;
  }
  const { files } = JSON.parse(readFileSync(report, "utf8")) as MutationReport;
  let detected = 0;
  let valid = 0;
  const survivors: string[] = [];
  for (const [file, { source, mutants }] of Object.entries(files)) {
    const sourceLines = source.split("\n");
    for (const m of mutants) {
      if (["Killed", "Timeout"].includes(m.status)) detected++;
      if (["Killed", "Timeout", "Survived", "NoCoverage"].includes(m.status)) {
        valid++;
      }
      if (["Survived", "NoCoverage"].includes(m.status)) {
        const oneLine = (text: string) =>
          text.replace(/\s+/g, " ").trim().slice(0, 100);
        const line = m.location.start.line;
        survivors.push(
          `- ${file}:${line} ${m.mutatorName}: ${oneLine(sourceLines[line - 1] ?? "")}  =>  ${oneLine(m.replacement ?? "")}`,
        );
      }
    }
  }
  const score = valid ? Math.round((100 * detected) / valid) : 100;
  save(
    `mutants/${unit.name}.md`,
    [
      `# Surviving mutants: ${unit.name}`,
      "",
      `Score ${score}%: ${detected} of ${valid} mutants detected by \`vitest run ${unit.paths.join(" ")}\`.`,
      "",
      ...survivors,
      "",
    ].join("\n"),
    `${survivors.length} survived of ${valid}, score ${score}%`,
  );
}

async function main([command, ...names]: string[]) {
  if (command === "mutate") {
    const chosen = names.length
      ? names.map((name) => {
          const unit = units.find((u) => u.name === name);
          if (!unit) throw new Error(`Unknown unit ${name}.`);
          return unit;
        })
      : units.filter((u) => u.mutate.length);
    console.log(`Units: ${chosen.map((u) => u.name).join(", ")}`);
    await withoutSupabase(run, async () => {
      for (const unit of chosen) await mutate(unit);
    });
  } else if (command === undefined) {
    console.log(`Units: ${units.map((u) => u.name).join(", ")}`);
    metrics();
    await Promise.all([knip(), jscpd(), coverage()]);
  } else {
    console.error("Usage: pnpm -s sweep [mutate [unit...]]");
    process.exit(1);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
