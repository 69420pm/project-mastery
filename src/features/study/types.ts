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
import type { MockStatus } from "@/features/study/domain/mock-paths";
import type { SessionMode } from "@/features/study/domain/modes";
import type { Pace, Phase, Plan } from "@/features/study/domain/plan";
import type { ProblemSource } from "@/features/study/domain/exercises";
import type { DueReviews } from "@/features/study/domain/reviews";
import type { PracticeKc } from "@/features/study/domain/practice";
import type { ReviewGroup } from "@/features/study/domain/review-queue";
import type { Stage } from "@/features/study/domain/stages";
import type { TodayPlan } from "@/features/study/domain/today";
import type { TopicState } from "@/features/study/domain/topic-state";

export type {
  AttemptHelp,
  AttemptResult,
  KcState,
  KcStateName,
  Phase,
  ProblemSource,
  Stage,
};

/** Why a Student flags a generated Problem. */
export type ProblemFlag = "unclear" | "wrong" | "too_easy" | "off_topic";

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
  /**
   * A review session's queue (`planReviewQueue`), in order; absent outside
   * review sessions and in contexts stored before #184.
   */
  reviewQueue?: ReviewGroup[];
  /**
   * A practice session's KCs (`selectPracticeKcs`), most urgent first;
   * absent outside practice sessions and in contexts stored before #184.
   */
  practiceKcs?: PracticeKc[];
  /**
   * A results session's graded Mock exam items, the most points lost
   * first (`byPointsLost`); absent outside results sessions.
   */
  mockResults?: MockReviewItem[];
  /**
   * The Course's newest Session notes of other sessions, newest first;
   * absent in contexts stored before #187.
   */
  sessionNotes?: SessionNoteEntry[];
  /**
   * In a learn session with a Topic, that Topic's note first, then the notes
   * of the Topics holding its anchors; absent otherwise and in contexts
   * stored before #187.
   */
  topicNotes?: TopicNoteEntry[];
};

/** A Session note as the AI is told of it. */
export type SessionNoteEntry = {
  /** The day the session ended, as YYYY-MM-DD. */
  date: string;
  mode: SessionMode;
  text: string;
};

/** A Topic note as the AI is told of it. */
export type TopicNoteEntry = {
  /** The Topic's name. */
  topic: string;
  text: string;
};

/** A graded Mock exam's item as a Results session goes through it. */
export type MockReviewItem = {
  /** Its task number in the mock, from 1. */
  number: number;
  prompt: string;
  /** Null when left blank. */
  answer: string | null;
  points: number;
  /** Null when it could not be graded. */
  pointsAwarded: number | null;
  steps: Array<{ points: number; reason: string }>;
  /** The Exercise's or Problem's solution; null without one. */
  reference: string | null;
  kcs: Array<{ id: string; name: string }>;
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

/** A source chunk as `getTopic` and `searchMaterials` return it. */
export type SourceChunkView = {
  chunkId: string;
  material: string;
  /** Such as "p. 3" or "pp. 3–4". */
  pages: string;
  /** The chunk on its Material's page, where its figure shows. */
  link: string;
  markdown: string;
};

/** A Problem as `findProblems` returns it. */
export type ProblemView = {
  /** The Problem's id, which a question on it names. */
  id: string;
  /**
   * An Exercise of an old exam or another one, or a generated variant of an
   * Exercise or new Problem.
   */
  source: ProblemSource;
  name: string;
  /** Null for a generated Problem without one. */
  taskType: string | null;
  /** 1 to 3. */
  difficulty: number;
  /** The question's Markdown. */
  question: string;
  /**
   * The question on its Material's page, where its figure shows; null for a
   * generated Problem.
   */
  link: string | null;
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
 * What a map Finding says is wrong with the Knowledge map: a link between
 * two KCs it lacks, a link it has that the sources contradict, or a KC's
 * description.
 */
export type MapFindingKind =
  "missing_link" | "wrong_link" | "wrong_description";

/** A map Finding on a KC as `getTopic` lists it. */
export type MapFindingView = {
  kind: MapFindingKind;
  /** The other KC of a link kind; null for `wrong_description`. */
  otherKc: { id: string; name: string } | null;
  reason: string;
};

/**
 * A map Finding on the Course map's Map findings card: an `open` one the
 * Student can accept or dismiss, or an `accepted` one the next Update map
 * applies. `linkedKc` is the other KC of a link kind, null otherwise.
 */
export type MapFindingItem = {
  id: string;
  kind: MapFindingKind;
  status: "open" | "accepted";
  kc: string;
  linkedKc: string | null;
  reason: string;
  quote: string;
  /** Such as "Lecture 3, p. 12", with the link to the chunk on its page. */
  source: { label: string; link: string } | null;
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
    sources: SourceChunkView[];
    /** Its open and accepted map Findings, oldest first. */
    findings: MapFindingView[];
  }>;
  anchors: Array<{ id: string; name: string; state: KcStateName }> | null;
  /** In order; `done` when the Student has a Done message for it. */
  readingSections: Array<ReadingSectionView & { done: boolean }> | null;
};

/** A Mock exam as its page shows it (#185). */
export type MockExamView = {
  id: string;
  courseId: string;
  status: MockStatus;
  /** Why it failed; null unless failed. */
  failure: string | null;
  /** While assembling: the missing Problems it generates, and how many are done. */
  gaps: { total: number; done: number };
  /** The sum of its items' minutes; null until ready. */
  durationMinutes: number | null;
  itemCount: number;
  /** The aids the Brief allows. */
  aids: string[];
  /** Whether it is the reserved exam itself. */
  final: boolean;
  /** When its time is up, in progress; null otherwise. */
  deadline: string | null;
  /** The server's time when the page loaded, which the countdown runs from. */
  serverNow: string;
  /** Its tasks in order, once started; empty before. */
  tasks: MockTask[];
  /** How many tasks grading has finished, of all. */
  grading: { done: number; total: number };
  /** Once graded: the score against the prediction; null before. */
  result: MockResult | null;
};

/** A graded Mock exam's score, over the tasks that could be graded. */
export type MockResult = {
  /** The share of points awarded, from 0 to 100. */
  scorePercent: number;
  /** The share Readiness predicted, from 0 to 100. */
  predictedPercent: number;
  /** Points per Topic, in task order; "Other" for tasks without a Topic. */
  topics: Array<{ name: string; awarded: number; points: number }>;
  /**
   * The Course's graded questions answered with confidence 4, and how many
   * of them were right (every attempt full); null without one.
   */
  sure: { right: number; total: number } | null;
};

/** A task of a started Mock exam, with the Student's answer so far. */
export type MockTask = {
  questionId: string;
  prompt: string;
  points: number;
  /** Null until saved. */
  answer: string | null;
  /** From 1 (unsure) to 4 (sure); null until given. */
  confidence: number | null;
  /**
   * Once grading finished with it: its points and steps, or `failed` when
   * it could not be graded; null before.
   */
  grade: MockTaskGrade | null;
};

/** A Course's Readiness for the map (see `readiness`). */
export type CourseReadiness = {
  /** Over every KC with a Priority, 0 to 1; null without Priorities. */
  course: number | null;
  /** Per Topic id, 0 to 1; a Topic without weighted KCs is missing. */
  topics: Record<string, number>;
  /** How many graded mocks check it; 0 means untested. */
  mocks: number;
  /** Whether it is projected to an exam date still ahead. */
  onTheDay: boolean;
};

/** How a Mock exam's task was graded. */
export type MockTaskGrade =
  | { status: "failed" }
  | {
      status: "graded";
      pointsAwarded: number;
      steps: Array<{ points: number; reason: string }>;
      /** The final value against the key; null when unchecked. */
      check: "match" | "mismatch" | null;
    };
