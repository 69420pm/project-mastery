import { readFile } from "node:fs/promises";
import { isStepCount, streamText, type ModelMessage } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import {
  TutorToolError,
  tutorTools,
  type TutorContext,
  type TutorToolActions,
} from "@/features/study/server";
import { costUsd, tokenUsage } from "@/lib/ai/cost";
import { aiTask } from "@/lib/ai/models";
import type { EvalDefinition } from "./eval";
import { pace } from "./learn";

/**
 * Map disagreements (#181): the real Chat instructions, model settings and
 * tools, with in-memory actions over the jet-engines gold course's second
 * Topic, Turbojet anatomy. A scripted Student, who reads the map as planted
 * with two errors, disputes a wrong prerequisite, a missing link, then
 * rebuilds the engine from memory with one claim the map lacks and one wrong
 * claim. The map is told by the Student, as the AI cannot read links.
 *
 * Code checks the Findings the AI filed against the item's expectations,
 * in a run of at most 25 model calls.
 */

const input = z.object({
  /** What the Student says, one message per reply. */
  messages: z.array(z.string().min(1)).min(1),
});

/** A link between two KCs, by gold id. */
const pairSchema = z.tuple([z.string(), z.string()]);

const expectedOutput = z.object({
  /** Findings that must be filed, each a link kind between two KCs. */
  required: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["missing_link", "wrong_link"]),
      pair: pairSchema,
    }),
  ),
  /** No Finding may name any of these KCs: the Student's claim is wrong. */
  wrongClaimKcs: z.array(z.string()),
  /** The chunk position the correction cites, by link or page. */
  correctionChunk: z.number(),
  /** The page of that chunk, as the reply may cite it. */
  correctionPage: z.number(),
  /** A word of the correct fact, which the correction states. */
  correctionPattern: z.string(),
});

type Input = z.infer<typeof input>;
type Expected = z.infer<typeof expectedOutput>;

/** As in the Chat handler. */
const MAX_STEPS = 5;
/** The run's model call cap. */
export const MAX_CALLS = 25;

const GOLD = "evals/gold/jet-engines/gold.json";
const CHUNKS = "evals/gold/jet-engines/chunks.json";

const goldSchema = z.object({
  bigIdeas: z.array(z.object({ id: z.string(), name: z.string() })),
  kcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      bigIdea: z.string().nullable(),
      sources: z.array(z.number()),
    }),
  ),
  prerequisites: z.array(z.object({ from: z.string(), to: z.string() })),
});
const chunksSchema = z.array(
  z.object({
    position: z.number(),
    page_from: z.number(),
    markdown: z.string(),
  }),
);

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const COURSE_ID = uuid(1);
const TOPIC_ID = uuid(2);
const MATERIAL_ID = uuid(5);
const MATERIAL = "Jet engines, Chapter 7";
const TOPIC = "BI2";

type Gold = z.infer<typeof goldSchema>;
type Chunk = z.infer<typeof chunksSchema>[number];

async function loadCourse() {
  const [gold, chunks] = await Promise.all([
    readFile(GOLD, "utf8"),
    readFile(CHUNKS, "utf8"),
  ]);
  return {
    gold: goldSchema.parse(JSON.parse(gold)),
    chunks: chunksSchema.parse(JSON.parse(chunks)),
  };
}

/** What the model's `searchMaterials` returns for a chunk. */
function chunkView({ position, page_from, markdown }: Chunk) {
  return {
    chunkId: `chunk-${position}`,
    material: MATERIAL,
    pages: `p. ${page_from}`,
    link: `/courses/${COURSE_ID}/materials/${MATERIAL_ID}#chunk-${position}`,
    markdown,
  };
}

const words = (text: string) =>
  new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** A Finding as the AI filed it; KC ids are gold ids. */
type Filed = {
  reply: number;
  kind: string;
  kcId: string;
  linkedKcId: string | null;
  chunkId: string;
  quote: string;
};

export type DisagreementRecord = {
  filed: Filed[];
  /** The AI's text of each reply. */
  replies: string[];
  searches: number;
  refusals: string[];
  calls: number;
  costUsd: number;
};

function actionsOf(
  { gold, chunks }: { gold: Gold; chunks: Chunk[] },
  record: DisagreementRecord,
  current: () => number,
): TutorToolActions {
  const toId = new Map(gold.kcs.map((kc, i) => [kc.id, uuid(0x100 + i)]));
  const toGold = new Map([...toId].map(([goldId, id]) => [id, goldId]));
  const chunkAt = (position: number) =>
    chunks.find((c) => c.position === position)!;
  const refuse = () => {
    throw new TutorToolError("This eval has no such tool.");
  };
  const kcView = (kc: Gold["kcs"][number]) => ({
    id: toId.get(kc.id)!,
    name: kc.name,
    type: kc.type,
    description: kc.description,
    state: "new" as const,
    sources: kc.sources.slice(0, 3).map((p) => chunkView(chunkAt(p))),
    findings: [],
  });
  return {
    loadStage: async () => null,
    saveStage: async () => false,
    getTopic: async (topicId, kcIds) => {
      const wanted = new Set(kcIds ?? []);
      const kcs = gold.kcs.filter((kc) =>
        kcIds ? wanted.has(toId.get(kc.id)!) : kc.bigIdea === TOPIC,
      );
      if (topicId !== null && topicId !== TOPIC_ID) return null;
      const outside = [...wanted].filter((id) => !toGold.has(id));
      if (outside.length > 0) {
        throw new TutorToolError(
          `These are no KC ids of this Course: ${outside.join(", ")}.`,
        );
      }
      return {
        id: topicId,
        name: topicId === null ? null : "Turbojet anatomy",
        centralQuestion: null,
        kcs: kcs.map(kcView),
        anchors: null,
        readingSections: null,
      };
    },
    searchMaterials: async (query) => {
      record.searches += 1;
      const wanted = words(query);
      return chunks
        .map((chunk) => ({
          chunk,
          score: [...words(chunk.markdown)].filter((w) => wanted.has(w)).length,
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(({ chunk }) => chunkView(chunk));
    },
    isKc: (id) => toGold.has(id),
    findChunk: async (chunkId) => {
      const chunk = chunks.find((c) => `chunk-${c.position}` === chunkId);
      return chunk ? { markdown: chunk.markdown } : null;
    },
    saveMapFinding: async (finding) => {
      record.filed.push({
        reply: current(),
        kind: finding.kind,
        kcId: toGold.get(finding.kcId) ?? finding.kcId,
        linkedKcId:
          finding.linkedKcId && (toGold.get(finding.linkedKcId) ?? null),
        chunkId: finding.chunkId,
        quote: finding.quote,
      });
      return uuid(0x2000 + record.filed.length);
    },
    findProblems: async () => ({ problems: [] }),
    findReading: async () => null,
    remember: async () => {},
    ask: async () => refuse(),
    findQuestion: async () => null,
    saveGrade: async () => refuse(),
  };
}

function contextOf({ gold }: { gold: Gold }): TutorContext {
  const id = (goldId: string) =>
    uuid(0x100 + gold.kcs.findIndex((k) => k.id === goldId));
  const kcs = gold.kcs.filter((kc) => kc.bigIdea === TOPIC);
  const inTopic = new Set(kcs.map((kc) => kc.id));
  const anchors = [
    ...new Set(
      gold.prerequisites
        .filter((p) => inTopic.has(p.to) && !inTopic.has(p.from))
        .map((p) => p.from),
    ),
  ].map((goldId) => gold.kcs.find((kc) => kc.id === goldId)!);
  return {
    today: "2026-11-02",
    examDate: "2026-12-03",
    hasMap: true,
    phase: "build",
    goal: "good_grade",
    memory: "",
    mapPath: `/courses/${COURSE_ID}/map`,
    dueReviews: { kcs: [], more: 0 },
    todayPlan: {
      next: {
        id: TOPIC_ID,
        name: "Turbojet anatomy",
        centralQuestion: "What does each section of a turbojet do to the air?",
        kcs: kcs.map(({ id: goldId, name, type }) => ({
          id: id(goldId),
          name,
          type,
          taught: false,
        })),
        anchors: anchors.map(({ id: goldId, name }) => ({
          id: id(goldId),
          name,
        })),
      },
      hint: null,
      fitLine: null,
    },
  };
}

async function runScript({ messages }: Input): Promise<DisagreementRecord> {
  const course = await loadCourse();
  const record: DisagreementRecord = {
    filed: [],
    replies: [],
    searches: 0,
    refusals: [],
    calls: 0,
    costUsd: 0,
  };
  let reply = 0;
  const tools = tutorTools(actionsOf(course, record, () => reply));
  const history: ModelMessage[] = [];
  const { model } = aiTask("chat");
  for (const message of messages) {
    if (record.calls >= MAX_CALLS) break;
    history.push({ role: "user", content: message });
    console.info(`  Student: ${message.slice(0, 100)}`);
    const text: string[] = [];
    const result = streamText({
      ...chatReplySettings(contextOf(course)),
      messages: history,
      tools,
      prepareStep: async () => {
        await pace();
        return {};
      },
      stopWhen: [
        isStepCount(MAX_STEPS),
        ({ steps }) => record.calls + steps.length >= MAX_CALLS,
      ],
    });
    for await (const part of result.stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text.push(part.text);
      if (part.type === "tool-call") {
        console.info(`    ${part.toolName} ${JSON.stringify(part.input)}`);
      }
      if (part.type === "tool-error") {
        const error =
          part.error instanceof Error ? part.error.message : String(part.error);
        record.refusals.push(`${part.toolName}: ${error}`);
      }
      if (part.type === "finish-step") record.calls += 1;
    }
    record.costUsd += costUsd(model, tokenUsage(await result.totalUsage));
    history.push(...(await result.response).messages);
    record.replies.push(text.join("").trim());
    console.info(
      `  AI: ${record.replies[reply]!.replaceAll("\n", " ").slice(0, 300)}`,
    );
    reply += 1;
  }
  return record;
}

// One script at a time: its calls follow each other under a rate limit.
let queue: Promise<unknown> = Promise.resolve();

async function disagreementTask(item: Input): Promise<string> {
  const run = queue.then(() => runScript(item));
  queue = run.catch(() => undefined);
  return JSON.stringify(await run);
}

type Check = { name: string; value: number; comment?: string };

const check = (name: string, passed: boolean, comment = ""): Check => ({
  name,
  value: passed ? 1 : 0,
  ...(comment && { comment }),
});

/** The code checks of one run, each 1 when it passes. */
export function checkDisagreement(
  record: DisagreementRecord,
  expected: Expected,
): Check[] {
  const touches = (f: Filed, kcs: string[]) =>
    kcs.includes(f.kcId) ||
    (f.linkedKcId !== null && kcs.includes(f.linkedKcId));
  const required = expected.required.map(({ name, kind, pair }) => {
    const found = record.filed.filter(
      (f) =>
        f.kind === kind &&
        f.linkedKcId !== null &&
        pair.includes(f.kcId) &&
        pair.includes(f.linkedKcId),
    );
    return check(
      `finding_${name}`,
      found.length > 0,
      `${found.length} ${kind} Findings on ${pair.join("–")}`,
    );
  });
  const wrong = record.filed.filter((f) => touches(f, expected.wrongClaimKcs));
  const last = record.replies.at(-1) ?? "";
  const cited =
    last.includes(`#chunk-${expected.correctionChunk}`) ||
    new RegExp(
      `\\b(p\\.|pp\\.|page)\\s*${expected.correctionPage}\\b`,
      "i",
    ).test(last);
  const states = new RegExp(expected.correctionPattern, "i").test(last);
  return [
    ...required,
    check(
      "no_finding_wrong_claim",
      wrong.length === 0,
      wrong.map((f) => `${f.kind} ${f.kcId}–${f.linkedKcId}`).join(", "),
    ),
    check(
      "wrong_claim_corrected_with_citation",
      cited && states,
      `cited ${cited}, states the fact ${states}`,
    ),
    check(
      "calls_within_budget",
      record.calls <= MAX_CALLS,
      `${record.calls} calls`,
    ),
  ];
}

const GATES = [
  "finding_wrong_prerequisite",
  "finding_missing_link",
  "finding_correct_claim",
  "no_finding_wrong_claim",
  "wrong_claim_corrected_with_citation",
  "calls_within_budget",
];

export const disagreementEval: EvalDefinition<Input, Expected> = {
  name: "disagreement",
  input,
  expectedOutput,
  task: disagreementTask,
  evaluators: [
    async ({ output, expectedOutput: expected }) => {
      const record = JSON.parse(output) as DisagreementRecord;
      return [
        ...checkDisagreement(record, expected!),
        {
          name: "model_calls",
          value: record.calls,
          comment: record.refusals.join("; "),
        },
        { name: "cost_usd", value: record.costUsd },
      ];
    },
  ],
  gates: GATES,
  minPassRate: 1,
};
