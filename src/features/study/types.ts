import type { CandidateGroup } from "@/features/study/domain/candidates";

/**
 * What code tells the AI on every reply in a Chat, so it is always current:
 * the dates and what to propose learning next from the Course's Knowledge
 * map.
 */
export type TutorContext = {
  /** As YYYY-MM-DD. */
  today: string;
  /** As YYYY-MM-DD; null when the Brief has none. */
  examDate: string | null;
  /** Whether the Course has a built Knowledge map. */
  hasMap: boolean;
  /** The map page, where the Student builds the map. */
  mapPath: string;
  /** Ranked and grouped by big idea; empty without a map. */
  candidates: CandidateGroup[];
};

/** A source chunk of a KC as `readKcs` returns it. */
export type KcSourceView = {
  material: string;
  /** Such as "p. 3" or "pp. 3–4". */
  pages: string;
  /** The chunk on its Material's page, where its figure shows. */
  link: string;
  markdown: string;
};

/** An Exercise as `findExercises` returns it. */
export type ExerciseView = {
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

/** A KC as `readKcs` returns it. */
export type KcReading = {
  id: string;
  name: string;
  type: string;
  description: string;
  /** Up to 3, in reading order. */
  sources: KcSourceView[];
};
