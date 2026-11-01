import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { MAX_TOPIC_NAME } from "@/features/knowledge-map/domain/topic-tree";
import { aiTask } from "@/lib/ai/models";

/** A Chapter of a Material's Outline as the tree call gets it. */
export type OfferedChapter = {
  /** Short and only for the call, such as c1. */
  id: string;
  title: string;
  /** 0 for the Material itself. */
  depth: number;
  /** The names of the KCs it holds; absent when it holds none. */
  kcs?: string[];
};

/** A stored Topic as the tree call gets it. */
export type OfferedStoredTopic = {
  /** Short and only for the call, such as t1. */
  id: string;
  name: string;
  /** 1 at the top. */
  level: number;
  /** The ids of the Chapters whose KCs it holds itself. */
  chapters: string[];
};

/** What the tree call gets: the Course's Outlines and its stored tree. */
export type OfferedCourse = {
  /** The Course language by name, such as English. */
  language: string;
  /** In Course order. */
  materials: Array<{ name: string; outline: OfferedChapter[] }>;
  storedTopics: OfferedStoredTopic[];
};

/**
 * What the tree call returns: the Topics in tree order as a flat list,
 * each with its level, so the schema needs no recursion. Ids are hints
 * that code checks (`offeredId`).
 */
export const topicTreeSchema = (
  chapterIds: readonly string[] = [],
  topicIds: readonly string[] = [],
) =>
  z.object({
    topics: z
      .array(
        z.object({
          level: z
            .int()
            .min(1)
            .describe(
              "1 for a top-level Topic; a Topic sits in the nearest Topic before it with a lower level.",
            ),
          name: z
            .string()
            .describe(
              `At most ${MAX_TOPIC_NAME} characters, without numbering.`,
            ),
          chapterIds: z
            .array(offeredId(chapterIds))
            .describe(
              "The Chapters whose KCs this Topic holds itself; empty when it only holds child Topics.",
            ),
          centralQuestion: z
            .string()
            .describe(
              "The one question its own KCs together answer; empty when it holds no Chapters.",
            ),
          continues: z
            .string()
            .meta(topicIds.length > 0 ? { enum: ["", ...topicIds] } : {})
            .describe(
              "The id of the stored Topic it continues; empty for a new Topic.",
            ),
        }),
      )
      .describe("Every Topic in tree order: a parent before its children."),
  });

const TREE_INSTRUCTIONS = `You get the materials of a university course as JSON: each material's outline of chapters in course order, with the names of the knowledge components (KCs) under each chapter that teaches some, and the course's stored Topic tree. Group the chapters into a tree of Topics a student learns one at a time.

- A Topic covers whole chapters. Give every chapter that has KCs to exactly one Topic, by its id; never list a chapter without KCs under chapterIds.
- Follow the outlines: a chapter with sections usually becomes a Topic whose children are its sections' Topics, in section order, also when the chapter has no KCs of its own; that parent Topic then holds no chapters itself. A chapter's KCs outside its sections can sit on that parent Topic itself.
- Join small neighbouring chapters on one subject into one Topic; split nothing.
- Where several materials teach the same subject, such as a script and an exercise sheet, put their chapters in the same Topic.
- List the Topics in tree order, each with its level: 1 at the top, a child one level below its parent.
- Name each Topic close to its chapters' titles, without numbering. Give a Topic that holds chapters the one question its KCs together answer.
- When a Topic is a stored one, kept or changed, give that stored Topic's id under continues, so the student's notes on it stay. Use each stored id at most once.
- Write in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the tree call of a Course (task `topic`), with
 * reasoning on:
 *
 *   streamText({ ...topicTreeSettings(c), messages: topicTreeMessages(c) })
 */
export function topicTreeSettings(course: OfferedCourse) {
  return {
    ...aiTask("topic"),
    reasoning: "high" as const,
    instructions: TREE_INSTRUCTIONS,
    output: Output.object({
      schema: topicTreeSchema(
        course.materials.flatMap((material) =>
          material.outline.flatMap((chapter) =>
            chapter.kcs ? [chapter.id] : [],
          ),
        ),
        course.storedTopics.map((topic) => topic.id),
      ),
    }),
  };
}

/** The user message of a tree call: the Course, as JSON. */
export function topicTreeMessages(course: OfferedCourse) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(course) }],
    },
  ];
}
