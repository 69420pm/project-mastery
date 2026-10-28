/**
 * The Langfuse write of `pnpm -s metrics`, behind one small interface so its
 * tests replace it (`MetricsLangfuse`). Needs the Langfuse keys;
 * `createMetricsLangfuse` is only called when they are set.
 */
import { LangfuseClient } from "@langfuse/client";

/** A numeric score on a Langfuse session, whose id is the Chat's id. */
export type SessionScore = {
  sessionId: string;
  name: string;
  value: number;
  /**
   * A fixed timestamp for the score, such as the Chat's creation: Langfuse
   * replaces a score sent again with the same id and timestamp.
   */
  timestamp: string;
};

/** What `pnpm -s metrics` writes; tests replace it. */
export type MetricsLangfuse = {
  /** Upserts scores, one per session and name. */
  writeSessionScores(scores: SessionScore[]): Promise<void>;
};

const SCORE_BATCH = 100;

export function createMetricsLangfuse(
  client: LangfuseClient = new LangfuseClient(),
): MetricsLangfuse {
  return {
    async writeSessionScores(scores) {
      for (let start = 0; start < scores.length; start += SCORE_BATCH) {
        await client.api.scores.create(
          scores.slice(start, start + SCORE_BATCH).map((score) => ({
            id: `${score.sessionId}-${score.name}`,
            sessionId: score.sessionId,
            name: score.name,
            value: score.value,
            dataType: "NUMERIC",
            timestamp: score.timestamp,
          })),
        );
      }
    },
  };
}
