import type {
  BloomLevel,
  CheckReport,
  KcType,
  SemanticLinkType,
} from "@/features/knowledge-map/schemas";

/** A chunk of the Course as a build reads it. */
export type MapChunk = {
  id: string;
  materialName: string;
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

/** Everything the map page shows of a Course. */
export type KnowledgeMapView = {
  courseId: string;
  build: MapBuild;
  bigIdeas: BigIdeaView[];
  /** Prior knowledge the material assumes, which belongs to no big idea. */
  priorKnowledge: KcView[];
  semanticLinks: SemanticLinkView[];
  /** Null before a build stored one. */
  checkReport: CheckReportView | null;
  /** Whether Build may start: a Material is parsed and none waits or parses. */
  canBuild: boolean;
};
