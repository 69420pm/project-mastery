import type { CandidateGroup } from "@/features/study/domain/candidates";
import type {
  AttemptHelp,
  AttemptResult,
  KcState,
  KcStateName,
} from "@/features/study/domain/replay";
import type { Phase } from "@/features/study/domain/plan";
import type { DueReviews } from "@/features/study/domain/reviews";

export type { AttemptHelp, AttemptResult, KcState, KcStateName, Phase };

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
  /** The relevant KCs that won't fit. */
  leftOut: Array<{ id: string; name: string }>;
  hoursPerWeek: number | null;
};

/** A source chunk of a KC as `readKcs` returns it. */
type KcSourceView = {
  material: string;
  /** Such as "p. 3" or "pp. 3–4". */
  pages: string;
  /** The chunk on its Material's page, where its figure shows. */
  link: string;
  markdown: string;
};

/** An Exercise as `findExercises` returns it. */
export type ExerciseView = {
  /** The Exercise's id, which a question on it names. */
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

/** What a Question asks for, which sets how its attempts count. */
export type QuestionKind =
  "prequestion" | "recall" | "question" | "problem" | "rebuild" | "mock_item";

/**
 * A KC of a graded Question as `grade` returns it, with its new state: no
 * next review or recall while its first session runs.
 */
export type GradedKc = {
  id: string;
  name: string;
  result: AttemptResult;
} & KcState;

/** A KC as `readKcs` returns it. */
export type KcReading = {
  id: string;
  name: string;
  type: string;
  description: string;
  /** Up to 3, in reading order. */
  sources: KcSourceView[];
};
