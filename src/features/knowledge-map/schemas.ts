import { z } from "zod";

// The course model of a Knowledge map (#51, #69). These schemas are the
// source of truth: the tables of the knowledge map migrations mirror them.

export const KC_TYPES = ["fact", "concept", "procedure", "decision"] as const;

/**
 * What a Finding reports: a printed solution that does not match, or a
 * remark in the material that excludes or limits exam content.
 */
export const FINDING_KINDS = ["solution_mismatch", "scope"] as const;

/** Whether the Student has answered a Finding in the Brief. */
export const FINDING_STATUSES = ["open", "answered"] as const;

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
 * An Exercise: one subtask whose question is the `questionChunk`, with the
 * KCs it tests, a difficulty from 1 (easy) to 3 (hard) and its numeric
 * final answers (null without any).
 */
const exerciseSchema = z.object({
  id,
  questionChunk: id,
  difficulty: z.int().min(1).max(3),
  kcs: z.array(id),
  finalAnswers: z.array(finalAnswerSchema).min(1).nullish(),
});

/**
 * Something the build found in the material for the Student to confirm, with
 * its chunks. Its review status and answer are the Student's and stay out
 * of the map.
 */
const findingSchema = z.object({
  id,
  kind: z.enum(FINDING_KINDS),
  text: z.string().trim().min(1).max(2000),
  sources: z.array(id),
});

/**
 * A Course's stored map: its rows by id, KCs, Exercises and Findings citing
 * chunk ids. Every reference must resolve and no Prerequisite may loop on
 * one KC.
 */
export const knowledgeMapSchema = z
  .object({
    bigIdeas: z.array(bigIdeaSchema),
    kcs: z.array(kcSchema),
    prerequisites: z.array(prerequisiteSchema),
    /** In reading order. */
    exercises: z.array(exerciseSchema),
    findings: z.array(findingSchema),
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
  /** `content` and `definition` chunks no KC cites. */
  uncoveredChunkIds: z.array(z.uuid()),
  /** Names of KCs without a source. */
  ungroundedKcs: z.array(name),
  /** Names of KCs without any Prerequisite. */
  orphanKcs: z.array(name),
  /** The Prerequisites dropped to break cycles, by KC name. */
  droppedCycleEdges: z.array(z.object({ from: name, to: name })),
  /** Exercises mapped to no KC, which fails the check. */
  unmappedExercises: z.array(name).default([]),
  /** Names of KCs no Exercise tests, reported only. */
  untestedKcs: z.array(name).default([]),
  /** KC pairs still alike enough to be duplicates after merging, reported only. */
  duplicates: z
    .array(z.object({ a: name, b: name, similarity: z.number() }))
    .default([]),
});

/** The input of the Build button's Server Action. */
export const startKnowledgeMapBuildSchema = z.object({ courseId: z.uuid() });

export type KcType = (typeof KC_TYPES)[number];
export type FindingKind = (typeof FINDING_KINDS)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type KnowledgeMap = z.infer<typeof knowledgeMapSchema>;
export type CheckReport = z.infer<typeof checkReportSchema>;
