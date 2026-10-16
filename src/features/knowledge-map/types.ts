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

/** A KC as the map page shows it. */
export type KcView = {
  id: string;
  name: string;
  description: string;
  type: KcType;
  bloom: BloomLevel | null;
  /** Added because exercises need it while the content does not teach it. */
  fromExercise: boolean;
  /** Where it is taught, such as "Lecture 1 p. 3", in reading order. */
  sources: string[];
  /** The names of the KCs to learn before it. */
  prerequisites: string[];
};

/** A semantic link between two KCs, by name. */
export type SemanticLinkView = {
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
  /** The names of the KCs it tests, in map order. */
  kcs: string[];
  solutionStatus: SolutionStatus;
  difficulty: 1 | 2 | 3;
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
 * badge and reasons by KC id (none before the first run), whether a run is
 * running and why the last one failed.
 */
export type MapPriorities = {
  running: boolean;
  failureReason: string | null;
  kcs: Record<
    string,
    { level: "high" | "medium" | "low" | "excluded"; reasons: string[] }
  >;
};

/**
 * The KC states the map page shows, which the page passes in: a KC's state
 * by id; a KC missing here is new.
 */
export type MapKcStates = Record<
  string,
  { state: "new" | "learning" | "due" | "mastered" }
>;

/**
 * The study plan the map page shows, which the page passes in: the Phase
 * (null without an exam date or once it has passed), the whole percent of
 * the KCs that matter that fit (null without pacing), the ids of the KCs
 * that won't, and the weekly hours.
 */
export type MapPlan = {
  phase: "build" | "deepen" | "final_week" | null;
  share: number | null;
  leftOut: string[];
  hoursPerWeek: number | null;
};

/** Everything the map page shows of a Course. */
export type KnowledgeMapView = {
  courseId: string;
  build: MapBuild;
  bigIdeas: BigIdeaView[];
  /** Prior knowledge the material assumes, which belongs to no big idea. */
  priorKnowledge: KcView[];
  semanticLinks: SemanticLinkView[];
  /** In reading order. */
  exercises: ExerciseView[];
  /** Null before a build stored one. */
  checkReport: CheckReportView | null;
  /** Whether Build may start: a Material is parsed and none waits or parses. */
  canBuild: boolean;
};
