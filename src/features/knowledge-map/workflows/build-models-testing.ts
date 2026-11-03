import { simulateReadableStream } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { vi } from "vitest";
import { useMockModels } from "@/lib/ai/testing";

/**
 * The mock models of the build workflow tests (`build-testing.ts` holds the
 * fake database): `map` extraction, merge and check calls, `exercise` calls
 * and `embed` vectors, one call at a time, every structured call streamed.
 */

type Prompt = Array<{ role: string; content: unknown }>;

/** The JSON of a call's user message. */
function userJson(prompt: unknown): Record<string, unknown> {
  const user = (prompt as Prompt).find((message) => message.role === "user");
  const [part] = user!.content as Array<{ text: string }>;
  return JSON.parse(part!.text) as Record<string, unknown>;
}

/** A teaching unit as its extraction call sent it. */
export type SentUnit = {
  material: string;
  outline: string[];
  language: string;
  chunks: Array<{ id: string; markdown: string }>;
};

/** The title of the unit's Chapter: its marked Outline line. */
export function unitTitle(unit: { outline: string[] }): string {
  const marked = unit.outline.find((line) => line.endsWith("<- this unit"));
  return marked!.replace("<- this unit", "").trim();
}

/** An exercise unit as its call sent it. */
export type SentExerciseUnit = {
  material: string;
  outline: string[];
  language: string;
  subtasks: Array<{ id: string; statement: string; solution: string | null }>;
  kcs: Array<{ id: string; name: string }>;
};

/** What the exercise mock answers for a subtask: KCs by name. */
export type SubtaskAnswer = {
  kcs?: string[];
  newKcs?: string[];
  finalAnswers?: Array<{ label: string; value: number; unit: string | null }>;
  notAnExercise?: boolean;
};

/** A streamed answer of `value` as JSON, or of nothing. */
const answer = (value: unknown) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "text-start" as const, id: "text-1" },
      {
        type: "text-delta" as const,
        id: "text-1",
        delta: value === undefined ? "" : JSON.stringify(value),
      },
      { type: "text-end" as const, id: "text-1" },
      {
        type: "finish" as const,
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
      },
    ],
  }),
});

/** The Course as the tree call sent it. */
export type SentCourse = {
  language: string;
  materials: Array<{
    name: string;
    outline: Array<{
      id: string;
      title: string;
      depth: number;
      kcs?: string[];
    }>;
  }>;
  storedTopics: Array<{
    id: string;
    name: string;
    level: number;
    chapters: string[];
  }>;
};

/** A Topic of the tree call's answer. */
export type TreeTopicAnswer = {
  level: number;
  name: string;
  chapterIds: string[];
  centralQuestion: string;
  continues: string;
};

/**
 * The default tree answer: one top-level Topic per Chapter with KCs, named
 * by its title, continuing the stored Topic that held that Chapter.
 */
export function flatTree(course: SentCourse): TreeTopicAnswer[] {
  return course.materials.flatMap((material) =>
    material.outline.flatMap((chapter) =>
      chapter.kcs
        ? [
            {
              level: 1,
              name: chapter.title,
              chapterIds: [chapter.id],
              centralQuestion: `What is ${chapter.title}?`,
              continues:
                course.storedTopics.find((topic) =>
                  topic.chapters.includes(chapter.id),
                )?.id ?? "",
            },
          ]
        : [],
    ),
  );
}

/** A name a KC assumes, as the Prerequisite check sent it. */
export type SentName = {
  id: string;
  name: string;
  description: string;
  usedBy: string;
  candidates: Array<{ id: string; name: string }>;
};

/**
 * Routes the `map`, `exercise` and `embed` tasks to mocks, one call at a
 * time. The extraction gives each unit the KCs `kcsOf` names (by default
 * one named after the unit's Chapter), citing its first chunk (or the id
 * `chunkIdOf` gives) and assuming the names `assumesOf` says (by default
 * nothing), each described "About <name>." as a KC of that name is; its
 * first `blankCalls` calls answer nothing. The merge call
 * calls KCs of one cluster with the same name the same. The Prerequisite
 * check picks the candidate named `meaningOf` the name (by default the name
 * itself). Every KC text gets a one-hot vector of its own, so equal texts
 * are alike and others are not. `afterCall` runs after each extraction
 * call. The `exercise` task answers each subtask with what `subtaskOf` says
 * (by default nothing), naming offered KCs by name.
 */
export function useBuildModels({
  kcsOf = (unit) => [unitTitle(unit)],
  assumesOf = () => [],
  chunkIdOf = (_kc, unit) => unit.chunks[0]!.id,
  meaningOf = (name) => name.name,
  subtaskOf = () => ({}),
  blankCalls = 0,
  afterCall,
  treeOf = flatTree,
}: {
  treeOf?: (course: SentCourse) => TreeTopicAnswer[];
  kcsOf?: (unit: SentUnit) => string[];
  assumesOf?: (kc: string) => string[];
  chunkIdOf?: (kc: string, unit: SentUnit) => string;
  meaningOf?: (name: SentName) => string | null;
  subtaskOf?: (subtask: SentExerciseUnit["subtasks"][number]) => SubtaskAnswer;
  blankCalls?: number;
  afterCall?: (count: number) => void;
} = {}) {
  const extractions: SentUnit[] = [];
  const merges: unknown[] = [];
  const checks: SentName[][] = [];
  const embedded: string[] = [];
  /** Each `map` call's reasoning setting. */
  const reasoning: unknown[] = [];
  const blanks = Array.from({ length: blankCalls }, () => true);
  const map = new MockLanguageModelV4({
    doStream: async (options) => {
      reasoning.push(options.reasoning);
      const sent = userJson(options.prompt);
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
      if (blanks.pop()) return answer(undefined);
      const unit = sent as SentUnit;
      extractions.push(unit);
      const result = answer({
        kcs: kcsOf(unit).map((name) => ({
          name,
          description: `About ${name}.`,
          chunkIds: [chunkIdOf(name, unit)],
          assumes: assumesOf(name).map((assumed) => ({
            name: assumed,
            description: `About ${assumed}.`,
          })),
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
  const trees: SentCourse[] = [];
  const topic = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const course = userJson(prompt) as SentCourse;
      trees.push(course);
      return answer({ topics: treeOf(course) });
    },
  });
  const exercises: SentExerciseUnit[] = [];
  const exercise = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const unit = userJson(prompt) as SentExerciseUnit;
      exercises.push(unit);
      return answer({
        subtasks: unit.subtasks.map((subtask) => {
          const said = subtaskOf(subtask);
          return {
            id: subtask.id,
            notAnExercise: said.notAnExercise ?? false,
            kcIds: (said.kcs ?? []).flatMap(
              (name) => unit.kcs.find((kc) => kc.name === name)?.id ?? [],
            ),
            newKcs: (said.newKcs ?? []).map((name) => ({
              name,
              description: `About ${name}.`,
            })),
            finalAnswers: said.finalAnswers ?? [],
          };
        }),
      });
    },
  });
  useMockModels({ map, embed, exercise, topic });
  vi.stubEnv("AI_CONCURRENCY", "1");
  return { extractions, merges, checks, embedded, exercises, reasoning, trees };
}
