import { z } from "zod";

// The course model of a Knowledge map (#51, #69). These schemas are the
// source of truth: the tables of the knowledge map migrations mirror them.

export const KC_TYPES = ["fact", "concept", "procedure", "decision"] as const;

/** Stored row ids. */
const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(1000);

const bigIdeaSchema = z.object({ id, name, description });

/**
 * A knowledge component that its `sources` chunks teach. It comes from the
 * content, or from an exercise that needs it when the content does not
 * teach it.
 */
const kcSchema = z.object({
  id,
  name,
  description,
  type: z.enum(KC_TYPES),
  bigIdea: id,
  origin: z.enum(["content", "exercise"]),
  sources: z.array(id),
});

/** `from` must be learned before `to`. */
const prerequisiteSchema = z.object({ from: id, to: id });

/**
 * One numeric final result of an Exercise, the key a Student's final value
 * is checked against: such as `{ label: "Thrust", value: 17.5, unit: "kN" }`.
 * The unit is written for mathjs; null for a number without one.
 */
export const finalAnswerSchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.number(),
  unit: z.string().trim().min(1).max(50).nullable(),
});

export type FinalAnswer = z.infer<typeof finalAnswerSchema>;

/**
 * An Exercise: one subtask whose question is the `questionChunk`, with its
 * printed solution's chunk (null without one), the KCs it tests, a
 * difficulty from 1 (easy) to 3 (hard) and its numeric final answers as
 * printed (null without any).
 */
const exerciseSchema = z.object({
  id,
  questionChunk: id,
  solutionChunk: id.nullable(),
  difficulty: z.int().min(1).max(3),
  kcs: z.array(id),
  finalAnswers: z.array(finalAnswerSchema).min(1).nullish(),
});

/**
 * A Course's stored map: its rows by id, KCs and Exercises citing chunk ids. Every reference must resolve and no Prerequisite may loop on
 * one KC.
 */
export const knowledgeMapSchema = z
  .object({
    bigIdeas: z.array(bigIdeaSchema),
    kcs: z.array(kcSchema),
    prerequisites: z.array(prerequisiteSchema),
    /** In reading order. */
    exercises: z.array(exerciseSchema),
  })
  .superRefine((map, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const bigIdeas = new Set(map.bigIdeas.map((bigIdea) => bigIdea.id));
    const kcs = new Set(map.kcs.map((kc) => kc.id));
    for (const kc of map.kcs) {
      if (!bigIdeas.has(kc.bigIdea)) {
        issue(`KC ${kc.id} names an unknown big idea ${kc.bigIdea}`);
      }
    }
    for (const exercise of map.exercises) {
      for (const kcId of exercise.kcs) {
        if (!kcs.has(kcId)) {
          issue(`exercise ${exercise.id} names an unknown KC ${kcId}`);
        }
      }
    }
    for (const link of map.prerequisites) {
      if (!kcs.has(link.from) || !kcs.has(link.to)) {
        issue(`link ${link.from} → ${link.to} names an unknown KC`);
      } else if (link.from === link.to) {
        issue(`link ${link.from} → ${link.to} loops on one KC`);
      }
    }
  });

/** What the build's checks found, stored with the map it checked. */
export const checkReportSchema = z.object({
  /** Each teaching Part's extracted KCs against its KC budget, by title. */
  kcsPerPart: z.array(
    z.object({ part: z.string(), kcs: z.int(), budget: z.int() }),
  ),
  /** Titles of teaching Parts no live KC cites. */
  partsWithoutKcs: z.array(z.string()),
  /** Labels of Exercises that test no KC. */
  exercisesWithoutKcs: z.array(z.string()),
  /** KC pairs still alike enough to be duplicates after merging, by name. */
  duplicates: z.array(z.object({ a: name, b: name, similarity: z.number() })),
});

/**
 * One subtask of an exercise Part's extraction: its question chunk, the
 * solution chunk paired with it when it was extracted, the candidate KCs it
 * tests by id and its new KCs by index into the extraction's `kcs`, its
 * final answers as printed and its printed solution's line count.
 */
const extractedExerciseSchema = z.object({
  chunkId: z.string(),
  solutionChunkId: z.string().nullable(),
  notAnExercise: z.boolean(),
  kcIds: z.array(z.string()),
  newKcs: z.array(z.int()),
  finalAnswers: z.array(finalAnswerSchema),
  solutionLines: z.int().nullable(),
});

export type ExtractedExercise = z.infer<typeof extractedExerciseSchema>;

/**
 * A stored Part extraction (`part_extractions.output`): its KCs with
 * stored chunk ids and, until they are stored, their vectors of
 * "name: description"; Prerequisites by index into `kcs`. An exercise
 * Part's also has its subtasks, whose new KCs are its `kcs`.
 */
export const storedExtractionSchema = z.object({
  kcs: z.array(
    z.object({
      name,
      description,
      type: z.enum(KC_TYPES),
      chunkIds: z.array(z.string()).min(1),
      assumes: z.array(z.string()),
      embedding: z.array(z.number()).optional(),
    }),
  ),
  prerequisites: z.array(z.object({ from: z.int(), to: z.int() })),
  /** A teaching Part's: how many KCs its call was asked for. */
  kcBudget: z.int().optional(),
  exercises: z.array(extractedExerciseSchema).optional(),
});

export type StoredExtraction = z.infer<typeof storedExtractionSchema>;

/** The input of the Build button's Server Action. */
export const startKnowledgeMapBuildSchema = z.object({ courseId: z.uuid() });

export type KcType = (typeof KC_TYPES)[number];
export type KnowledgeMap = z.infer<typeof knowledgeMapSchema>;
export type CheckReport = z.infer<typeof checkReportSchema>;
