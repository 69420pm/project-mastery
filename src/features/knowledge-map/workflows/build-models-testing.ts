import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";

/**
 * The mock models of the build workflow tests (`build-testing.ts` holds the
 * fake database): `map` extraction and merge calls, `exercise` calls and
 * `embed` vectors, one call at a time.
 */

type Prompt = Array<{ role: string; content: unknown }>;

/** The JSON of a call's user message. */
function userJson(prompt: unknown): Record<string, unknown> {
  const user = (prompt as Prompt).find((message) => message.role === "user");
  const [part] = user!.content as Array<{ text: string }>;
  return JSON.parse(part!.text) as Record<string, unknown>;
}

/** A Part as its extraction call sent it. */
export type SentPart = {
  title: string;
  chapterTitle: string;
  language: string;
  kcBudget: number;
  chunks: Array<{ id: string; markdown: string }>;
};

/** An exercise Part as its call sent it. */
export type SentExercisePart = {
  title: string;
  language: string;
  subtasks: Array<{
    id: string;
    number: string | null;
    statement: string;
    solution: string | null;
  }>;
  kcs: Array<{ id: string; name: string }>;
};

/** What the exercise mock answers for a subtask: KCs by name. */
export type SubtaskAnswer = {
  kcs?: string[];
  newKcs?: string[];
  finalAnswers?: Array<{ label: string; value: number; unit: string | null }>;
  notAnExercise?: boolean;
};

const answer = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: {
      total: 100,
      noCache: 100,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 10, text: 10, reasoning: undefined },
  },
  warnings: [],
});

/** A name a KC assumes, as the Prerequisite check sent it. */
export type SentName = {
  id: string;
  name: string;
  usedBy: string;
  candidates: Array<{ id: string; name: string }>;
};

/** A Big idea's new Topics, as the naming call sent them. */
export type SentBigIdea = {
  bigIdea: string;
  language: string;
  topics: Array<{ id: string; parts: string[]; kcs: string[] }>;
};

/**
 * Routes the `map`, `exercise`, `topic` and `embed` tasks to mocks, one
 * call at a time. The extraction gives each Part the KCs `kcsOf` names (by
 * default one named after the Part's title), all citing its first chunk
 * and assuming what `assumesOf` says (by default nothing); the merge call
 * calls KCs of one cluster with the same name the same. The Prerequisite
 * check picks the candidate named `meaningOf` the name (by default the
 * name itself). Every KC text gets a one-hot vector of its own, so equal
 * texts are alike and others are not. `afterCall` runs after each
 * extraction call. The `exercise` task answers each subtask with what
 * `subtaskOf` says (by default nothing), naming offered KCs by name. The
 * `topic` task names each Topic "Topic <its Parts' titles>".
 */
export function useBuildModels({
  kcsOf = (part) => [part.title],
  assumesOf = () => [],
  meaningOf = (name) => name.name,
  subtaskOf = () => ({}),
  afterCall,
}: {
  kcsOf?: (part: SentPart) => string[];
  assumesOf?: (kc: string) => string[];
  meaningOf?: (name: SentName) => string | null;
  subtaskOf?: (subtask: SentExercisePart["subtasks"][number]) => SubtaskAnswer;
  afterCall?: (count: number) => void;
} = {}) {
  const extractions: SentPart[] = [];
  const merges: unknown[] = [];
  const checks: SentName[][] = [];
  const embedded: string[] = [];
  const map = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const sent = userJson(prompt);
      if ("names" in sent) {
        const names = sent.names as SentName[];
        checks.push(names);
        return answer({
          meanings: Object.fromEntries(
            names.map((name) => [
              name.id,
              name.candidates.find((kc) => kc.name === meaningOf(name))?.id ??
                null,
            ]),
          ),
        });
      }
      if ("clusters" in sent) {
        merges.push(sent);
        const clusters = sent.clusters as Array<{
          kcs: Array<{ id: string; name: string }>;
        }>;
        return answer({
          same: clusters.flatMap((cluster) =>
            [...Map.groupBy(cluster.kcs, (kc) => kc.name).values()]
              .filter((group) => group.length > 1)
              .map((group) => ({ kcIds: group.map((kc) => kc.id) })),
          ),
        });
      }
      const part = sent as SentPart;
      extractions.push(part);
      const result = answer({
        kcs: kcsOf(part).map((name) => ({
          name,
          description: `About ${name}.`,
          type: "concept",
          chunkIds: [part.chunks[0]!.id],
          assumes: assumesOf(name),
        })),
        prerequisites: [],
      });
      afterCall?.(extractions.length);
      return result;
    },
  });
  const dimensions = 64;
  const texts: string[] = [];
  const embed = new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => {
      embedded.push(...values);
      return {
        embeddings: values.map((text) => {
          if (!texts.includes(text)) texts.push(text);
          return Array.from({ length: dimensions }, (_, index) =>
            index === texts.indexOf(text) % dimensions ? 1 : 0,
          );
        }),
        usage: undefined,
        warnings: [],
      };
    },
  });
  const exercises: SentExercisePart[] = [];
  const exercise = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const part = userJson(prompt) as SentExercisePart;
      exercises.push(part);
      return answer({
        subtasks: part.subtasks.map((subtask) => {
          const said = subtaskOf(subtask);
          return {
            id: subtask.id,
            notAnExercise: said.notAnExercise ?? false,
            kcIds: (said.kcs ?? []).flatMap(
              (name) => part.kcs.find((kc) => kc.name === name)?.id ?? [],
            ),
            newKcs: (said.newKcs ?? []).map((name) => ({
              name,
              description: `About ${name}.`,
              type: "procedure",
            })),
            finalAnswers: said.finalAnswers ?? [],
          };
        }),
      });
    },
  });
  const namings: SentBigIdea[] = [];
  const topic = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const sent = userJson(prompt) as SentBigIdea;
      namings.push(sent);
      return answer({
        topics: Object.fromEntries(
          sent.topics.map((topic) => [
            topic.id,
            {
              name: `Topic ${topic.parts.join(", ")}`,
              centralQuestion: `What is ${topic.parts.join(", ")}?`,
            },
          ]),
        ),
      });
    },
  });
  useMockModels({ map, embed, exercise, topic });
  vi.stubEnv("AI_CONCURRENCY", "1");
  return { extractions, merges, checks, namings, embedded, exercises };
}
