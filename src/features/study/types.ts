import type {
  AttemptHelp,
  AttemptResult,
} from "@/features/study/domain/replay";
import type { MockStatus } from "@/features/study/domain/mock-paths";
import type { Pace, Progress, TopicScope } from "@/features/study/domain/plan";
import type { ProblemSource } from "@/features/study/domain/exercises";
import type { KcBand, RecallBand } from "@/features/study/domain/recall-band";

export type {
  AttemptHelp,
  AttemptResult,
  KcBand,
  ProblemSource,
  RecallBand,
  TopicScope,
};

/** Why a Student flags a generated Problem. */
export type ProblemFlag = "unclear" | "wrong" | "too_easy" | "off_topic";

/**
 * The facts code gives the AI on every reply in a Chat (#251), rebuilt for
 * each reply: the dates, this session, the ranking's proposal, every Topic,
 * the notes and, in a session that goes through a Mock exam, its tasks. It
 * goes in front of the newest Student message (`renderTutorContext`).
 */
export type TutorContext = {
  /** As YYYY-MM-DD. */
  today: string;
  /** As YYYY-MM-DD; null when the Brief has none. */
  examDate: string | null;
  /** From today to the exam date; null without one. */
  daysLeft: number | null;
  /** The Student's goal from the Brief; null until answered. */
  goal: "pass" | "good_grade" | "master_everything" | null;
  session: SessionFacts;
  proposal: Proposal;
  /** The first 8 refreshes of the ranking. */
  practice: ContextKc[];
  /** Every Topic with KCs of its own, in Course order. */
  topics: ContextTopic[];
  notes: ContextNotes;
  /** The graded mock's tasks, most points lost first; null otherwise. */
  mock: ContextMockTask[] | null;
};

/** A KC as the tutor context names it. */
export type ContextKc = {
  id: string;
  name: string;
  band: RecallBand;
  /** 0 to 1; null untaught. */
  recallToday: number | null;
};

/** What this Study session has done so far. */
export type SessionFacts = {
  minutes: number;
  /** The Course's Attempts of today, oldest first. */
  checkedToday: Array<{
    id: string;
    name: string;
    result: AttemptResult;
    help: AttemptHelp;
  }>;
  /** The session's newest Question while it is ungraded; null otherwise. */
  openQuestion: {
    prompt: string;
    kcs: Array<{ id: string; name: string }>;
    answered: boolean;
  } | null;
  /** Since the session's last graded Question; null without one. */
  minutesSinceGraded: number | null;
  /** The Reading sections this session's `showReading` calls opened. */
  readings: ReadingSectionView[];
};

/**
 * The head of the ranking: due Reviews and the next Topic or, in the final
 * stretch, the first items, as everything ranks together then.
 */
export type Proposal =
  | {
      finalStretch: false;
      /** The first 10 due Reviews. */
      reviews: ContextKc[];
      /** How many more are due. */
      moreReviews: number;
      topic: ProposedTopic | null;
    }
  | {
      finalStretch: true;
      items: Array<{
        kind: "review" | "topic" | "refresh";
        id: string;
        name: string;
      }>;
    };

/** The Topic the ranking proposes to teach next. */
export type ProposedTopic = {
  id: string;
  name: string;
  centralQuestion: string;
  /** In teaching order. */
  kcs: ContextKc[];
  anchors: ContextKc[];
  /** What its KCs assume from outside the Materials, by KC name. */
  assumes: Array<{ kc: string; name: string; description: string }>;
  readings: ReadingSectionView[];
  /** The unseen Problems that test any of its KCs. */
  unseenProblems: number;
};

/** A Topic as one line of the tutor context. */
export type ContextTopic = {
  id: string;
  name: string;
  status: TopicScope["status"];
  learned: number;
  total: number;
};

/** The notes the AI reads on every reply. */
export type ContextNotes = {
  /** Of the proposed Topic and the Topics touched today. */
  topics: Array<{ topic: string; text: string }>;
  /** What the AI noted about the Student in this Course; "" without notes. */
  memory: string;
  /** The last 4,000 characters of the Brief's notes; null without notes. */
  briefNotes: string | null;
  /**
   * The notes of the Course's Materials (`materials.notes`), in Material
   * order, Materials without notes left out.
   */
  materialNotes: MaterialNoteEntry[];
  /** The latest earlier session with Attempts; null without one. */
  lastSession: {
    /** As YYYY-MM-DD. */
    date: string;
    topics: string[];
    /** KCs checked, and how many of them had an Attempt below `full`. */
    kcs: number;
    belowFull: number;
  } | null;
};

/** A task of the graded Mock exam a session goes through. */
export type ContextMockTask = {
  prompt: string;
  answer: string | null;
  points: number;
  /** Null when grading failed. */
  awarded: number | null;
  reasons: string[];
  /** The Exercise or generated Problem it posed; null for neither. */
  problemId: string | null;
};

/** A Material's notation and conventions as the AI is told of them. */
export type MaterialNoteEntry = {
  /** The Material's name. */
  material: string;
  text: string;
};

/** An item of the ranking (`rankNext`) as the Today card shows it. */
export type NextItem = {
  /** A due KC, a Topic with untaught KCs, or a taught KC to refresh. */
  kind: "review" | "topic" | "refresh";
  /** The KC's id, or the Topic's. */
  id: string;
  name: string;
  /** The Topic's central question; null for a KC. */
  centralQuestion: string | null;
  /** At the Student's pace. */
  minutes: number;
};

/** Where the Student stands on a Topic with KCs of its own. */
export type TopicStudy = {
  /** Its KCs that are learned, of all of them. */
  learned: number;
  total: number;
  /** 0 to 1; null without weighted KCs. */
  readiness: number | null;
};

/**
 * Where a Course's study stands, derived on every read (`getStudyState`):
 * the ranking, the plan scope, Progress, Readiness and the latest graded
 * mock's score.
 */
export type StudyState = {
  hasMap: boolean;
  /** Whether the stored map has Topics; false before a build stored them. */
  hasTopics: boolean;
  examDate: string | null;
  /** The exam day and the 7 days before it. */
  finalStretch: boolean;
  /** What is worth doing next, best first. */
  ranking: NextItem[];
  /** Each stored Topic's place in the plan, in Course order. */
  scope: TopicScope[];
  /** By Topic id; only Topics with KCs of their own. */
  topics: Record<string, TopicStudy>;
  progress: Progress;
  readiness: CourseReadiness;
  /** The latest graded Mock exam's score, 0 to 100; null without one. */
  lastMockPercent: number | null;
  /** Whether any KC is taught. */
  taught: boolean;
  pace: Pace;
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

/**
 * The Problem a Question poses, as `ask` returns it for the Chat to show in
 * place of the prompt.
 */
export type AskedProblem = {
  /** Markdown with LaTeX. */
  statement: string;
  /** An Exercise's page, such as "Sheet 2, p. 3"; null for a generated one. */
  page: { label: string; link: string } | null;
  /** The generated Problem, which the Student can flag; null for an Exercise. */
  generatedProblemId: string | null;
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
 * A KC of a graded Question as `grade` returns it, with its new band.
 */
export type GradedKc = {
  id: string;
  name: string;
  result: AttemptResult;
} & KcBand;

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
  /**
   * Each KC checked in the session, in the order first checked, with its
   * latest result there and its next review.
   */
  kcs: Array<{
    id: string;
    name: string;
    result: AttemptResult;
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
    band: RecallBand;
    /** 0 to 1; null untaught. */
    recallToday: number | null;
    /** What it assumes from outside the Materials. */
    assumes: Array<{ name: string; description: string }>;
    /** Up to 3, in reading order; none for a KC not asked for. */
    sources: SourceChunkView[];
  }>;
  anchors: Array<{ id: string; name: string; band: RecallBand }> | null;
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

/** A Course's Readiness (see `readiness`). */
export type CourseReadiness = {
  /** Over every KC with a Priority, 0 to 1; null without Priorities. */
  course: number | null;
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
