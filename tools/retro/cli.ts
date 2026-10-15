/**
 * Digests Claude Code transcripts of this repo for a retro:
 *
 *   pnpm -s retro              recent runs, newest first
 *   pnpm -s retro <id>         one run and its subagents (id prefix from the list)
 *
 * A /build run leaves megabytes of JSONL. This prints what a retro looks at
 * first (cost, context size, errors, hook blocks, big tool results, repeated
 * calls, the prompt and the handoff), each with the transcript line it came
 * from, so the raw record can be found without reading the whole file. Costs
 * are API list prices from PRICES, also for usage on a subscription.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped transcript JSON
type Rec = Record<string, any>;
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

// USD per million tokens: input, 5-minute cache write, 1-hour cache write,
// cache read, output. Anthropic list prices as of 2026-10; add a model here
// when a run reports it as unpriced.
const PRICES: Record<string, [number, number, number, number, number]> = {
  "claude-fable-5-1": [10, 12.5, 20, 0.25, 50],
  "claude-opus-5-5": [4, 5, 8, 0.2, 20],
  "claude-sonnet-5-5": [2, 2.5, 4, 0.2, 10],
  // Prompts over 100k tokens cost 5 times as much on Haiku 5.5.
  "claude-haiku-5-5": [0.1, 0.125, 0.2, 0.01, 0.5],
};

/** A turn's cost in USD, or undefined when the model has no price. */
function turnCost(model: string, u: Usage): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  const [input, write5m, write1h, read, output] = price;
  const write = u.cache_creation_input_tokens ?? 0;
  const long = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const prompt =
    (u.input_tokens ?? 0) + write + (u.cache_read_input_tokens ?? 0);
  const factor = model.startsWith("claude-haiku") && prompt > 100_000 ? 5 : 1;
  return (
    (factor *
      ((u.input_tokens ?? 0) * input +
        (write - long) * write5m +
        long * write1h +
        (u.cache_read_input_tokens ?? 0) * read +
        (u.output_tokens ?? 0) * output)) /
    1e6
  );
}

const mainRoot = path.dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      encoding: "utf8",
    },
  ).trim(),
);
const projectsDir = path.join(
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
  "projects",
);
const prefix = mainRoot.replace(/[^a-zA-Z0-9]/g, "-");

const short = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
const k = (n: number) =>
  n < 1000 ? String(Math.round(n)) : `${Math.round(n / 1000)}k`;
const usd = (n: number) => `$${n.toFixed(2)}`;

function readJsonl(file: string): Rec[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => {
      try {
        return { ...JSON.parse(line), _line: i + 1 };
      } catch {
        return null;
      }
    })
    .filter((r): r is Rec => r !== null);
}

function sessions() {
  return readdirSync(projectsDir)
    .filter((d) => d === prefix || d.startsWith(`${prefix}--claude-worktrees-`))
    .flatMap((d) =>
      readdirSync(path.join(projectsDir, d))
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const file = path.join(projectsDir, d, f);
          return {
            id: f.replace(".jsonl", ""),
            file,
            where: d === prefix ? "main" : d.slice(prefix.length + 19),
            mtime: statSync(file).mtime,
          };
        }),
    )
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Claude Code's own total for the session, when it wrote one. It also counts
 * calls that never reach the transcripts, such as titles and summaries.
 */
const recordedCost = (recs: Rec[]): number | undefined =>
  recs.findLast((r) => r.type === "cost-state")?.totalCostUSD;

/** The session's own transcript first, then its subagents' with their type. */
function agentFiles(sessionFile: string) {
  const dir = sessionFile.replace(/\.jsonl$/, "/subagents");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {}
  return [
    { name: "main", file: sessionFile },
    ...files.map((f) => {
      const file = path.join(dir, f);
      let meta: Rec = {};
      try {
        meta = JSON.parse(
          readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8"),
        );
      } catch {}
      return {
        name: `${meta.agentType ?? "agent"}: ${meta.description ?? ""}`,
        file,
      };
    }),
  ];
}

function userText(r: Rec): string | undefined {
  if (r.type !== "user" || r.isMeta || r.isCompactSummary) return undefined;
  const c = r.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return undefined;
  const texts = c.filter((b: Rec) => b.type === "text").map((b: Rec) => b.text);
  return texts.length ? texts.join("\n") : undefined;
}

function toolLabel(name: string, input: Rec): string {
  const arg =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.description ??
    input.skill ??
    input.url ??
    "";
  return `${name} ${short(String(arg), 90)}`;
}

function analyze(recs: Rec[]) {
  const usage = new Map<string, { model: string; u: Usage }>();
  const tools = new Map<
    string,
    { label: string; name: string; line: number; at: number }
  >();
  const toolCounts = new Map<string, number>();
  const errors = new Map<string, { lines: number[] }>();
  const results: {
    label: string;
    size: number;
    line: number;
    seconds: number;
  }[] = [];
  const calls = new Map<string, number[]>();
  const messages: string[] = [];
  let finalText = "";
  let compactions = 0;
  let prompt: string | undefined;

  for (const r of recs) {
    if (r.isCompactSummary) compactions++;
    if (r.type === "assistant") {
      const m = r.message;
      if (m?.id && m.usage) usage.set(m.id, { model: m.model, u: m.usage });
      for (const b of m?.content ?? []) {
        if (b.type === "text" && b.text.trim()) finalText = b.text;
        if (b.type !== "tool_use") continue;
        const label = toolLabel(b.name, b.input ?? {});
        const at = Date.parse(r.timestamp);
        tools.set(b.id, { label, name: b.name, line: r._line, at });
        toolCounts.set(b.name, (toolCounts.get(b.name) ?? 0) + 1);
        calls.set(label, [...(calls.get(label) ?? []), r._line]);
      }
    }
    const text = userText(r);
    if (text !== undefined && !text.startsWith("<")) {
      if (prompt === undefined) prompt = text;
      else messages.push(`L${r._line} ${short(text, 300)}`);
    }
    if (r.type !== "user" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message.content) {
      if (b.type !== "tool_result") continue;
      const tool = tools.get(b.tool_use_id);
      const label = tool?.label ?? "?";
      const body =
        typeof b.content === "string"
          ? b.content
          : (b.content ?? []).map((c: Rec) => c.text ?? "").join("\n");
      const seconds = tool ? (Date.parse(r.timestamp) - tool.at) / 1000 : 0;
      results.push({ label, size: body.length, line: r._line, seconds });
      if (b.is_error) {
        const key = `${tool?.name ?? "?"} → ${short(body, 220)}`;
        const e = errors.get(key) ?? { lines: [] };
        e.lines.push(r._line);
        errors.set(key, e);
      }
    }
  }

  const turns = [...usage.values()].filter((t) => t.model !== "<synthetic>");
  const costs = turns.map((t) => turnCost(t.model, t.u));
  const ctx = (u: Usage) =>
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0);
  const times = recs.map((r) => Date.parse(r.timestamp)).filter(Boolean);
  return {
    prompt,
    start: times.length
      ? new Date(Math.min(...times)).toISOString().slice(11, 16)
      : "?",
    minutes: times.length
      ? Math.round((Math.max(...times) - Math.min(...times)) / 60000)
      : 0,
    finalText,
    messages,
    compactions,
    turns,
    cost: costs.reduce((sum: number, c) => sum + (c ?? 0), 0),
    unpriced: [
      ...new Set(
        turns.filter((_, i) => costs[i] === undefined).map((t) => t.model),
      ),
    ],
    models: [...new Set(turns.map((t) => t.model))].join(", "),
    peak: Math.max(0, ...turns.map((t) => ctx(t.u))),
    output: turns.reduce((s, t) => s + (t.u.output_tokens ?? 0), 0),
    toolCounts: [...toolCounts].sort((a, b) => b[1] - a[1]),
    errors: [...errors].sort((a, b) => b[1].lines.length - a[1].lines.length),
    big: results.toSorted((a, b) => b.size - a.size).slice(0, 5),
    slow: results
      .filter((r) => r.seconds >= 60)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 5),
    repeats: [...calls]
      .filter(([, lines]) => lines.length >= 3)
      .sort((a, b) => b[1].length - a[1].length),
  };
}

function list() {
  for (const s of sessions().slice(0, 20)) {
    const recs = readJsonl(s.file);
    const agents = agentFiles(s.file);
    const cost =
      recordedCost(recs) ??
      agents.reduce(
        (sum, a) =>
          sum + analyze(a.file === s.file ? recs : readJsonl(a.file)).cost,
        0,
      );
    const title =
      recs.findLast((r) => r.type === "ai-title")?.aiTitle ??
      recs.findLast((r) => r.type === "last-prompt")?.lastPrompt ??
      "";
    const subs = agents.length - 1;
    console.log(
      [
        s.mtime.toISOString().slice(0, 16).replace("T", " "),
        s.id.slice(0, 8),
        s.where.padEnd(12),
        usd(cost).padStart(7),
        subs ? `${subs} agents` : "        ",
        short(String(title), 70),
      ].join("  "),
    );
  }
}

function digest(id: string) {
  const s = sessions().find((x) => x.id.startsWith(id));
  if (!s) throw new Error(`No session ${id} under ${projectsDir}/${prefix}*`);
  const agents = agentFiles(s.file)
    .map((a) => {
      const recs = readJsonl(a.file);
      return { ...a, recs, ...analyze(recs) };
    })
    .sort((a, b) =>
      (a.recs[0]?.timestamp ?? "").localeCompare(b.recs[0]?.timestamp ?? ""),
    );
  const priced = agents.reduce((sum, a) => sum + a.cost, 0);
  const recorded = recordedCost(
    agents.find((a) => a.file === s.file)?.recs ?? [],
  );
  const unpriced = [...new Set(agents.flatMap((a) => a.unpriced))];

  console.log(
    `Session ${s.id} (${s.where}), ${usd(recorded ?? priced)}, ${agents.length} agent(s)${unpriced.length ? `, no price for ${unpriced.join(", ")}` : ""}`,
  );
  if (recorded !== undefined && recorded - priced >= 0.01)
    console.log(
      `${usd(recorded - priced)} of it is Claude Code usage outside the transcripts (titles, summaries)`,
    );
  for (const a of agents) {
    console.log(`\n## ${a.name}`);
    console.log(`file ${a.file}`);
    console.log(
      `${usd(a.cost)}, from ${a.start} UTC for ${a.minutes} min, ${a.turns.length} turns, ${a.models}, peak context ${k(a.peak)}, output ${k(a.output)}${a.compactions ? `, ${a.compactions} compactions` : ""}`,
    );
    console.log(
      `tools: ${a.toolCounts.map(([n, c]) => `${n} ${c}`).join(", ")}`,
    );
    if (a.prompt) console.log(`prompt: ${short(a.prompt, 500)}`);
    if (a.messages.length) {
      console.log(
        "messages after the prompt (user, SendMessage, hook feedback):",
      );
      for (const m of a.messages) console.log(`  ${m}`);
    }
    if (a.errors.length) {
      console.log("tool errors:");
      for (const [key, { lines }] of a.errors)
        console.log(
          `  ${lines.length}× L${lines.slice(0, 5).join(",")} ${key}`,
        );
    }
    if (a.repeats.length) {
      console.log("repeated calls:");
      for (const [label, lines] of a.repeats.slice(0, 8))
        console.log(`  ${lines.length}× ${label}`);
    }
    if (a.slow.length) {
      console.log("slowest tool calls:");
      for (const r of a.slow)
        console.log(
          `  L${r.line} ${Math.round(r.seconds / 60)} min ${r.label}`,
        );
    }
    console.log("largest tool results:");
    for (const r of a.big)
      console.log(`  L${r.line} ${k(r.size / 4)} tokens ${r.label}`);
    console.log(`final message: ${short(a.finalText, 1200)}`);
  }
}

// Piping into `head` closes stdout early; that is not an error.
process.stdout.on("error", () => process.exit(0));

const id = process.argv[2];
if (id) digest(id);
else list();
