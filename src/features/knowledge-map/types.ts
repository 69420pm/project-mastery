import type { CheckReport, KcType } from "@/features/knowledge-map/schemas";

/** A chunk of the Course as a build reads it. */
export type MapChunk = {
  id: string;
  materialName: string;
  /** The page it starts on. */
  pageFrom: number;
  label: string;
  markdown: string;
};

/** Where a Course's last Knowledge map build stands; null: never built. */
export type MapBuild = {
  status: "building" | "built" | "failed";
  failureReason: string | null;
  /** When the shown map was built, as an ISO timestamp; null before one. */
  finishedAt: string | null;
} | null;

/** A chunk that teaches a KC, as the map page shows it. */
export type KcSourceView = {
  chunkId: string;
  material: string;
  /** Such as "p. 3" or "pp. 3–4". */
  pages: string;
  /** The chunk on its Material's page. */
  link: string;
  markdown: string;
};

/** A KC as the map page shows it. */
export type KcView = {
  id: string;
  name: string;
  description: string;
  type: KcType;
  /**
   * From the content, or from an exercise that needs it while the content
   * does not teach it.
   */
  origin: "content" | "exercise";
  /** The chunks that teach it, in reading order. */
  sources: KcSourceView[];
};

/** `from` must be learned before `to`, both KC ids. */
type PrerequisiteView = {
  from: string;
  to: string;
};

/** The last build's check report. */
export type CheckReportView = CheckReport;

/** A big idea with its KCs, as the map page shows it. */
export type BigIdeaView = {
  id: string;
  name: string;
  description: string;
  kcs: KcView[];
};

/** An Exercise as the map page shows it. */
export type ExerciseView = {
  id: string;
  /**
   * Its label, built when read from where its question is printed, such as
   * "Sheet 3 p. 2".
   */
  name: string;
  /** The ids of the KCs it tests, in map order. */
  kcs: string[];
  difficulty: 1 | 2 | 3;
  /** Its question chunk's Markdown; null if the chunk is gone. */
  question: string | null;
  /** The printed solution's Markdown; null without one. */
  solution: string | null;
};

/**
 * The KC priorities the map page shows, which the page passes in: each KC's
 * level, value and reasons by KC id.
 */
export type MapPriorities = {
  kcs: Record<
    string,
    {
      level: "high" | "medium" | "low" | "excluded";
      value: number;
      reasons: string[];
    }
  >;
};

/** A KC's attempt as the map page shows it. */
export type MapAttempt = {
  /** An ISO timestamp. */
  createdAt: string;
  result: "full" | "partial" | "wrong";
  help: "none" | "some" | "solution_shown";
  exerciseId: string | null;
};

/**
 * What the Student has learned of each KC, which the page passes in, by KC
 * id: its state, next review and today's recall, and its attempts newest
 * first. A KC missing here is new, without attempts.
 */
export type MapKcLearning = Record<
  string,
  {
    state: "new" | "learning" | "due" | "known";
    /** As YYYY-MM-DD; null without an FSRS card. */
    nextReview: string | null;
    /** Today's FSRS recall, 0 to 1; null without an FSRS card. */
    retrievability: number | null;
    attempts: MapAttempt[];
  }
>;

/** A stored Topic as the Course map shows it, in Course order. */
export type MapTopic = {
  id: string;
  bigIdeaId: string;
  name: string;
  centralQuestion: string;
  /** In teaching order. */
  kcs: Array<{ id: string; name: string }>;
};

/**
 * Where the Student stands on a Topic: its Topic state and the mean of its
 * KCs' recall today, 0 to 1.
 */
export type MapTopicState = {
  state: "new" | "in_progress" | "learned" | "solid" | "needs_work";
  recall: number;
};

/**
 * Each Topic's `MapTopicState`, which the page passes in, by Topic id. A
 * Topic missing here is new, with no recall.
 */
export type MapTopicStates = Record<string, MapTopicState>;

/**
 * Each Topic's Readiness, 0 to 1, which the page passes in, by Topic id. A
 * Topic missing here shows none.
 */
export type MapTopicReadiness = Record<string, number>;

/**
 * The study plan's badges of each Topic, such as "won't fit", which the
 * page passes in, by Topic id. A Topic missing here has none.
 */
export type MapTopicBadges = Record<string, string[]>;

/** A Topic as its page shows it, with what a Student reads around it. */
export type MapTopicDetail = MapTopic & {
  /** Prerequisites from outside the Topic. */
  anchors: Array<{ id: string; name: string }>;
  /** Such as "Lecture 1, pp. 3–5", linking to the section's first chunk. */
  readingSections: Array<{ label: string; href: string }>;
};

/** Everything the map page shows of a Course. */
export type KnowledgeMapView = {
  courseId: string;
  build: MapBuild;
  bigIdeas: BigIdeaView[];
  prerequisites: PrerequisiteView[];
  /** In reading order. */
  exercises: ExerciseView[];
  /** Null before a build stored one. */
  checkReport: CheckReportView | null;
  /** Whether Build may start: a Material is parsed and none waits or parses. */
  canBuild: boolean;
};
