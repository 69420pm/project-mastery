import type {
  KnowledgeMapView,
  MapKcLearning,
  MapPriorities,
} from "@/features/knowledge-map";
import type {
  AttemptHelp,
  AttemptResult,
  KcState,
  KcStateName,
} from "@/features/study/domain/replay";
import type { Pace, Phase, Plan } from "@/features/study/domain/plan";
import type { DueReviews } from "@/features/study/domain/reviews";
import type { Stage } from "@/features/study/domain/stages";
import type { TodayPlan } from "@/features/study/domain/today";
import type { TopicState } from "@/features/study/domain/topic-state";

export type { AttemptHelp, AttemptResult, KcState, KcStateName, Phase, Stage };

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
  /** The Student's goal from the Brief; null until answered. */
  goal: "pass" | "good_grade" | "master_everything" | null;
  /** What the AI noted about the Student in this Course; "" without notes. */
  memory: string;
  /** The map page, where the Student builds the map. */
  mapPath: string;
  /** Most urgent first; none without a map. */
  dueReviews: DueReviews;
  /**
   * What to work on after the due reviews, from the Today card. Contexts
   * stored before #177 have none.
   */
  todayPlan: TutorToday;
  /**
   * The learn session's stage; null without a Topic. Contexts stored before
   * #180 have none.
   */
  session?: TutorSession | null;
};

/** A learn session's stage as the AI is told of it. */
export type TutorSession = {
  stage: Stage;
  /** Where the session goes after `review`. */
  afterReview: Stage;
  /** Whole minutes since the session started. */
  minutes: number;
};

/** The Today card's work as the AI is told of it. */
export type TutorToday = {
  /** Null without a map, Topics or a Topic to work on. */
  next: {
    id: string;
    name: string;
    centralQuestion: string;
    /** In teaching order; `taught` when it has an FSRS schedule. */
    kcs: Array<{ id: string; name: string; type: string; taught: boolean }>;
    /** Prerequisites from outside the Topic, prior KCs included. */
    anchors: Array<{ id: string; name: string }>;
    /**
     * The Topic's Reading sections in order. Contexts stored before #179
     * have none.
     */
    readingSections?: ReadingSectionView[];
  } | null;
  /** Such as "Practice exam-style problems"; null in build. */
  hint: string | null;
  /** The fit line (`fitText`); null without a fit. */
  fitLine: string | null;
};

/**
 * A Course's study plan over its Topics as the map and the Brief show it
 * (`planStudy`), with the Brief's weekly hours, the measured pace it used,
 * whether the Course has a map and today's work (`planToday`).
 */
export type StudyPlan = Plan & {
  hoursPerWeek: number | null;
  pace: Pace;
  hasMap: boolean;
  today: TodayPlan;
};

/** A source chunk of a KC as `getTopic` returns it. */
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

/** How a Student reads a Reading section's pages. */
export type ReadingMode = "original" | "annotated" | "study_text";

/** A Reading section as the AI is told of it. */
export type ReadingSectionView = {
  id: string;
  /** Its Material and pages, such as "Lecture 3, pp. 12–14". */
  label: string;
  mode: ReadingMode;
};

/** A Reading section as `showReading` returns it. */
export type ReadingView = {
  label: string;
  mode: ReadingMode;
  /** Its chunks' Markdown, in reading order. */
  chunks: string[];
  /** The study text the Student reads; only in `study_text` mode. */
  studyText?: string;
};

/**
 * A Study session as its close card shows it, computed as if it had ended
 * (`loadSessionSummary`).
 */
export type SessionSummary = {
  /** The session's Topic and its new state; null without a Topic. */
  topic: ({ name: string } & TopicState) | null;
  /** Each KC with attempts in the session, with its state and next review. */
  kcs: Array<{
    id: string;
    name: string;
    state: KcStateName;
    /** As YYYY-MM-DD; null without a card. */
    nextReview: string | null;
  }>;
  /** Whether the session has ended, by End session, rating or idling. */
  ended: boolean;
  /** 1 to 5; null until rated. */
  rating: number | null;
  ratingNote: string | null;
};

/**
 * A Topic's part of the Knowledge map as the Chat's side slot shows it
 * (`getTopicKnowledgeMap`).
 */
export type TopicKnowledgeMap = {
  name: string;
  map: KnowledgeMapView;
  priorities: MapPriorities;
  learning: MapKcLearning;
};

/**
 * A Topic as `getTopic` returns it. Read by KC ids alone, without a Topic,
 * it has only the KCs: the Topic's fields are null.
 */
export type TopicView = {
  id: string | null;
  name: string | null;
  centralQuestion: string | null;
  /** In teaching order. */
  kcs: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    state: KcStateName;
    /** Up to 3, in reading order; none for a KC not asked for. */
    sources: KcSourceView[];
  }>;
  anchors: Array<{ id: string; name: string; state: KcStateName }> | null;
  /** In order; `done` when the Student has a Done message for it. */
  readingSections: Array<ReadingSectionView & { done: boolean }> | null;
};
