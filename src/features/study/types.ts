import type {
  AttemptHelp,
  AttemptResult,
  KcState,
  KcStateName,
} from "@/features/study/domain/replay";
import type { MockStatus } from "@/features/study/domain/mock-paths";
import type { Pace, Phase, Plan, Progress } from "@/features/study/domain/plan";
import type { ProblemSource } from "@/features/study/domain/exercises";
import type { TodayPlan } from "@/features/study/domain/today";

export type {
  AttemptHelp,
  AttemptResult,
  KcState,
  KcStateName,
  Phase,
  ProblemSource,
};

/** Why a Student flags a generated Problem. */
export type ProblemFlag = "unclear" | "wrong" | "too_easy" | "off_topic";

/**
 * What code tells the AI on every reply in a Chat, so it is always current:
 * the dates, the goal and the notes about the Student and the Materials.
 */
export type TutorContext = {
  /** As YYYY-MM-DD. */
  today: string;
  /** As YYYY-MM-DD; null when the Brief has none. */
  examDate: string | null;
  /** The Student's goal from the Brief; null until answered. */
  goal: "pass" | "good_grade" | "master_everything" | null;
  /** What the AI noted about the Student in this Course; "" without notes. */
  memory: string;
  /** The last 4,000 characters of the Brief's notes; null without notes. */
  briefNotes: string | null;
  /**
   * The notes of the Course's Materials (`materials.notes`), in Material
   * order, Materials without notes left out.
   */
  materialNotes: MaterialNoteEntry[];
};

/** A Material's notation and conventions as the AI is told of them. */
export type MaterialNoteEntry = {
  /** The Material's name. */
  material: string;
  text: string;
};

/**
 * A Course's study plan over its Topics as the map and the Brief show it
 * (`planStudy`), with the measured pace it used, whether the Course has a
 * map, today's work (`planToday`), the Brief's exam date and the Progress
 * (`planProgress`).
 */
export type StudyPlan = Plan & {
  pace: Pace;
  hasMap: boolean;
  today: TodayPlan;
  examDate: string | null;
  progress: Progress;
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

/**
 * A KC of a graded Question as `grade` returns it, with its new state: no
 * next review or recall while its first session runs.
 */
export type GradedKc = {
  id: string;
  name: string;
  result: AttemptResult;
} & KcState;

/** A Reading section as the AI is told of it. */
export type ReadingSectionView = {
  id: string;
  /** Its Material and pages, such as "Lecture 3, pp. 12–14". */
  label: string;
};

/** A Reading section as `showReading` returns it. */
export type ReadingView = {
  label: string;
  /** Its chunks' Markdown, in reading order. */
  chunks: string[];
};

/**
 * A Study session as its close card shows it, computed as if it had ended
 * (`loadSessionSummary`).
 */
export type SessionSummary = {
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
    description: string;
    state: KcStateName;
    /** Up to 3, in reading order; none for a KC not asked for. */
    sources: SourceChunkView[];
  }>;
  anchors: Array<{ id: string; name: string; state: KcStateName }> | null;
  /** In order. */
  readingSections: ReadingSectionView[] | null;
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
      /** The worst check of the final values; null without keys. */
      check: "match" | "mismatch" | "unchecked" | null;
    };
