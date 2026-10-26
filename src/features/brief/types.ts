import type { UIMessage } from "ai";
import type { BriefFields } from "@/features/brief/domain/intake";

/** What the server attaches to an AI message of a Brief. */
type BriefMessageMetadata = {
  /** The model that wrote the reply. */
  modelId?: string;
};

/** A message of a Brief, as `useChat` shows it and the database stores it. */
export type BriefUIMessage = UIMessage<BriefMessageMetadata>;

/** What the study plan reads of a Brief; each null until answered. */
export type ExamFacts = Pick<BriefFields, "examDate" | "hoursPerWeek" | "goal">;

/** A Course's Brief conversation and data for its page. */
export type BriefWithMessages = {
  courseId: string;
  messages: BriefUIMessage[];
  /** The exam facts, each null until answered. */
  fields: BriefFields;
  /** Markdown the AI keeps about the exam; null when empty. */
  notes: string | null;
  /** When the notes last changed, as an ISO timestamp. */
  notesUpdatedAt: string | null;
  /** The Materials the exam excludes, oldest first, with their chunk page. */
  excludedMaterials: Array<{ id: string; name: string; href: string }>;
  /**
   * The Student's answer to the reservation question: the reserved old exam
   * with its chunk page, or "none"; null before they answered.
   */
  reservedExam: { name: string; href: string } | "none" | null;
};
