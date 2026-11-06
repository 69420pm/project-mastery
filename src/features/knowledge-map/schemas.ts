import { z } from "zod";

// The course model of a Knowledge map (#51, #69). These schemas are the
// source of truth: the tables of the knowledge map migrations mirror them.

/** Stored row ids. */
const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(1000);

/**
 * A knowledge component that its `sources` chunks teach. It comes from the
 * content, or from an exercise that needs it when the content does not
 * teach it. A KC the Materials assume but never teach has no sources.
 */
const kcSchema = z.object({
  id,
  name,
  description,
  origin: z.enum(["content", "exercise"]),
  sources: z.array(id),
});

/** `from` must be learned before `to`. */
const prerequisiteSchema = z.object({ from: id, to: id });

/**
 * One final result of an Exercise or a generated Problem, the key a
 * Student's final value is checked against (`domain/answer-keys.ts`): such
 * as `{ label: "Thrust", value: "17.5 kN", anyOrder: false }`.
 */
/** The longest answer key or final value read. */
export const MAX_ANSWER_LENGTH = 500;

export const answerKeySchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
  anyOrder: z.boolean(),
});

/**
 * An Exercise: one subtask whose question is the `questionChunk`, with its
 * printed solution's chunk (null without one), the KCs it tests, a
 * difficulty from 1 (easy) to 3 (hard) and its answer keys as printed (null
 * without any).
 */
const exerciseSchema = z.object({
  id,
  questionChunk: id,
  solutionChunk: id.nullable(),
  difficulty: z.int().min(1).max(3),
  kcs: z.array(id),
  finalAnswers: z.array(answerKeySchema).min(1).nullish(),
});

/**
 * A Course's stored map: its rows by id, KCs and Exercises citing chunk ids. Every reference must resolve and no Prerequisite may loop on
 * one KC.
 */
export const knowledgeMapSchema = z
  .object({
    kcs: z.array(kcSchema),
    prerequisites: z.array(prerequisiteSchema),
    /** In reading order. */
    exercises: z.array(exerciseSchema),
  })
  .superRefine((map, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const kcs = new Set(map.kcs.map((kc) => kc.id));
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
  /** Titles of Chapters with content of their own that no live KC cites. */
  chaptersWithoutKcs: z.array(z.string()),
  /** Labels of Exercises that test no KC. */
  exercisesWithoutKcs: z.array(z.string()),
  /** KC pairs still alike enough to be duplicates after merging, by name. */
  duplicates: z.array(z.object({ a: name, b: name, similarity: z.number() })),
  /**
   * Teaching units whose KCs cite less than MIN_UNIT_COVERAGE of them, by
   * their Chapters' titles, with the share they cite.
   */
  unitsBelowCoverage: z.array(
    z.object({ chapter: z.string(), coverage: z.number() }),
  ),
  /** Pages read without units, unreadable or uncovered, per Material. */
  unreadPages: z.array(
    z.object({ material: z.string(), pages: z.array(z.number().int()) }),
  ),
});

/**
 * One subtask of an exercise unit's extraction: its question chunk, the
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
  finalAnswers: z.array(answerKeySchema),
  solutionLines: z.int().nullable(),
});

export type ExtractedExercise = z.infer<typeof extractedExerciseSchema>;

/**
 * A stored unit extraction (`chapter_extractions.output`): its KCs with
 * stored chunk ids, what each assumes (`{ name, description }`) and, until
 * they are stored, their vectors of "name: description"; Prerequisites by
 * index into `kcs`. An exercise
 * unit's also has its subtasks, whose new KCs are its `kcs`.
 */
export const storedExtractionSchema = z.object({
  kcs: z.array(
    z.object({
      name,
      description,
      chunkIds: z.array(z.string()).min(1),
      assumes: z.array(z.object({ name, description })),
      embedding: z.array(z.number()).optional(),
    }),
  ),
  prerequisites: z.array(z.object({ from: z.int(), to: z.int() })),
  exercises: z.array(extractedExerciseSchema).optional(),
});

export type StoredExtraction = z.infer<typeof storedExtractionSchema>;

/**
 * What a KC assumes that no KC of the Course means (`kcs.assumes`): names
 * with a one-line description, unique by name.
 */
export const kcAssumesSchema = z.array(z.object({ name, description }));

/** The input of the Build button's Server Action. */
export const startKnowledgeMapBuildSchema = z.object({ courseId: z.uuid() });

export type KnowledgeMap = z.infer<typeof knowledgeMapSchema>;
export type CheckReport = z.infer<typeof checkReportSchema>;
