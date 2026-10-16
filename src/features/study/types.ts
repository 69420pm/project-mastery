import type { CandidateGroup } from "@/features/study/domain/candidates";
import type { KcStateName } from "@/features/study/domain/ladder";
import type { Phase } from "@/features/study/domain/plan";
import type { DueReviews } from "@/features/study/domain/reviews";

export type { KcStateName, Phase };

/**
 * What code tells the AI on every reply in a Chat, so it is always current:
 * the dates, the due reviews and what to propose learning next from the
 * Course's Knowledge map.
 */
export type TutorContext = {
  /** As YYYY-MM-DD. */
  today: string;
  /** As YYYY-MM-DD; null when the Brief has none. */
  examDate: string | null;
  /** Whether the Course has a built Knowledge map. */
  hasMap: boolean;
  /** Where the study stands (`planStudy`); null without a running exam date. */
  phase: Phase | null;
  /** The whole percent of relevant KCs that fit; null without pacing. */
  share: number | null;
  /** How many relevant KCs won't fit; null without pacing. */
  leftOutCount: number | null;
  /** The Student's goal from the Brief; null until answered. */
  goal: "pass" | "good_grade" | "master_everything" | null;
  /** What the AI noted about the Student in this Course; "" without notes. */
  memory: string;
  /** The map page, where the Student builds the map. */
  mapPath: string;
  /** Most urgent first; none without a map. */
  dueReviews: DueReviews;
  /** Ranked and grouped by big idea; empty without a map. */
  candidates: CandidateGroup[];
};

/**
 * A Course's study plan as the map page shows it (`planStudy`): no Phase
 * without an exam date or once it has passed; share and left-out KCs only
 * with pacing.
 */
export type StudyPlan = {
  phase: Phase | null;
  /** The whole percent of relevant KCs that fit; null without pacing. */
  share: number | null;
  /** The ids of the relevant KCs that won't fit. */
  leftOut: string[];
  hoursPerWeek: number | null;
};

/**
 * A KC's place on the review ladder, replayed from its attempts on every
 * read. Level and next review are null for a new KC.
 */
export type KcState = {
  state: KcStateName;
  /** 1 to 5. */
  level: number | null;
  /** As YYYY-MM-DD. */
  nextReview: string | null;
};

/** What `recordAttempt` returns for each KC it recorded. */
export type RecordedKc = {
  id: string;
  name: string;
  /** 1 to 5. */
  level: number;
  /** As YYYY-MM-DD. */
  nextReview: string;
};

/** A source chunk of a KC as `readKcs` returns it. */
export type KcSourceView = {
  material: string;
  /** Such as "p. 3" or "pp. 3–4". */
  pages: string;
  /** The chunk on its Material's page, where its figure shows. */
  link: string;
  markdown: string;
};

/** An Exercise as `findExercises` returns it. */
export type ExerciseView = {
  /** What `recordAttempt` takes as `exerciseId`. */
  id: string;
  name: string;
  taskType: string;
  /** 1 to 3. */
  difficulty: number;
  /** The question's Markdown. */
  question: string;
  /** The question on its Material's page, where its figure shows. */
  link: string;
  /** The KCs it tests, by id and name. */
  kcs: Array<{ id: string; name: string }>;
  solution: {
    /** Where it comes from and how far it is checked. */
    status: string;
    /** Null when the Course has no solution for it. */
    markdown: string | null;
  };
};

/** A KC as `readKcs` returns it. */
export type KcReading = {
  id: string;
  name: string;
  type: string;
  description: string;
  /** Up to 3, in reading order. */
  sources: KcSourceView[];
};
