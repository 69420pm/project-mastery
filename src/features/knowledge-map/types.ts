import type {
  BloomLevel,
  CheckReport,
  FindingKind,
  FindingStatus,
  KcType,
  SemanticLinkType,
  SolutionStatus,
} from "@/features/knowledge-map/schemas";

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
  bloom: BloomLevel | null;
  /**
   * From the content, from an exercise that needs it while the content does
   * not teach it, or prior knowledge.
   */
  origin: "content" | "exercise" | "prior";
  /** The chunks that teach it, in reading order. */
  sources: KcSourceView[];
};

/** `from` must be learned before `to`, both KC ids. */
type PrerequisiteView = {
  from: string;
  to: string;
  /** How sure the build was of the link, 0 to 1. */
  confidence: number;
};

/** A semantic link between two KCs, by id. */
type SemanticLinkView = {
  from: string;
  to: string;
  coreType: SemanticLinkType;
  label: string;
};

/** The last build's check report, with chunks as "Lecture 1 p. 3". */
export type CheckReportView = Omit<CheckReport, "uncoveredChunkIds"> & {
  uncoveredChunks: string[];
};

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
  name: string;
  taskType: string;
  /** The ids of the KCs it tests, in map order. */
  kcs: string[];
  solutionStatus: SolutionStatus;
  difficulty: 1 | 2 | 3;
  /** Its question chunk's Markdown; null if the chunk is gone. */
  question: string | null;
  /** The generated solution, or the printed one's Markdown; null without. */
  solution: string | null;
};

/**
 * A Finding as the Brief's panel shows it: when it was asked and answered
 * (ISO timestamps), the answer, and its sources as links to their chunks,
 * labelled "Lecture 1 p. 3".
 */
export type FindingView = {
  id: string;
  text: string;
  status: FindingStatus;
  askedAt: string | null;
  answeredAt: string | null;
  answer: string | null;
  sources: Array<{ label: string; href: string }>;
};

/** An open Finding as the Brief asks it. */
export type ReviewFinding = {
  id: string;
  kind: FindingKind;
  text: string;
  /** Where it was found, such as "Lecture 1 p. 3", in reading order. */
  sources: string[];
  /** Whether the Brief has asked the Student about it. */
  asked: boolean;
};

/**
 * The KC priorities the map page shows, which the page passes in: each KC's
 * level, value, multiplier and reasons by KC id (none before the first run),
 * whether a run is running and why the last one failed.
 */
export type MapPriorities = {
  running: boolean;
  failureReason: string | null;
  kcs: Record<
    string,
    {
      level: "high" | "medium" | "low" | "excluded";
      value: number;
      multiplier: number;
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
 * id: its state, next review and today's recall, its attempts newest first,
 * and whether the AI would propose it next, with the KCs it docks onto. A
 * KC missing here is new, without attempts, and no candidate.
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
    /** Among the AI's top candidates to learn next. */
    candidate: boolean;
    /** Its Prerequisites that are prior knowledge or taught, as a candidate. */
    anchors: Array<{ id: string; name: string }>;
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

/** A Topic as its page shows it, with what a Student reads around it. */
export type MapTopicDetail = MapTopic & {
  whyItMatters: string;
  /** Prerequisites from outside the Topic, prior KCs included. */
  anchors: Array<{ id: string; name: string }>;
  /** Such as "Lecture 1, pp. 3–5", linking to the section's first chunk. */
  readingSections: Array<{ label: string; href: string }>;
};

/** Everything the map page shows of a Course. */
export type KnowledgeMapView = {
  courseId: string;
  build: MapBuild;
  bigIdeas: BigIdeaView[];
  /** Prior knowledge the material assumes, which belongs to no big idea. */
  priorKnowledge: KcView[];
  prerequisites: PrerequisiteView[];
  semanticLinks: SemanticLinkView[];
  /** In reading order. */
  exercises: ExerciseView[];
  /** Null before a build stored one. */
  checkReport: CheckReportView | null;
  /** Whether Build may start: a Material is parsed and none waits or parses. */
  canBuild: boolean;
};
