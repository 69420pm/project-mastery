/**
 * The Langfuse reads and writes of the eval commands, behind one small
 * interface so their tests replace it (`EvalLangfuse`). Needs the Langfuse
 * keys; `createEvalLangfuse` is only called when they are set.
 */
import { LangfuseClient } from "@langfuse/client";

/** The last model call of one traced Chat reply, with its input and output. */
export type ChatReplyTrace = {
  traceId: string;
  startTime: string;
  /** The messages sent to the model, as Langfuse stored them (parsed JSON). */
  input: unknown;
  /** The model's answer, as Langfuse stored it (parsed JSON or text). */
  output: unknown;
};

/** A human score from an annotation queue, on one trace. */
export type AnnotationScore = {
  traceId: string;
  value: boolean;
  timestamp: string;
};

export type EvalLangfuse = {
  /**
   * The most recent Chat replies (`chat-reply` traces), newest first, up to
   * `limit`, leaving out the traces in `exclude`.
   */
  chatReplies(options: {
    limit: number;
    exclude: ReadonlySet<string>;
  }): Promise<ChatReplyTrace[]>;
  /** One Chat reply by its trace id, or undefined when it has no model call. */
  chatReply(traceId: string): Promise<ChatReplyTrace | undefined>;
  /** The id of the annotation queue named `name`, or undefined. */
  annotationQueueId(name: string): Promise<string | undefined>;
  /** The ids of the traces in an annotation queue. */
  queuedTraceIds(queueId: string): Promise<Set<string>>;
  addToQueue(queueId: string, traceId: string): Promise<void>;
  /**
   * Writes a pass/fail score on a trace. One score per trace and name: a
   * second write replaces the first.
   */
  writeTraceScore(score: {
    traceId: string;
    name: string;
    pass: boolean;
    comment: string;
  }): Promise<void>;
  /** The human (annotation) scores named `name` on traces, oldest first. */
  annotationScores(name: string): Promise<AnnotationScore[]>;
};

const CHAT_REPLY_TRACE = "chat-reply";
const PAGE_SIZE = 50;
/** Enough pages to find `limit` new traces among replies of several steps. */
const MAX_PAGES = 20;

/** Langfuse returns observation input and output as raw strings. */
function parseIo(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

type Observation = {
  traceId: string | null;
  startTime: string;
  input?: unknown;
  output?: unknown;
};

function toTrace(observation: Observation): ChatReplyTrace | undefined {
  if (!observation.traceId) return undefined;
  return {
    traceId: observation.traceId,
    startTime: observation.startTime,
    input: parseIo(observation.input),
    output: parseIo(observation.output),
  };
}

/**
 * Keeps each trace's last model call: a reply with tool calls has one per
 * step, and the last one has the whole Chat as input and the reply's text as
 * output.
 */
function lastCallPerTrace(observations: Observation[]) {
  const byTrace = new Map<string, ChatReplyTrace>();
  for (const observation of observations) {
    const trace = toTrace(observation);
    if (!trace) continue;
    const seen = byTrace.get(trace.traceId);
    if (!seen || seen.startTime < trace.startTime) {
      byTrace.set(trace.traceId, trace);
    }
  }
  return [...byTrace.values()];
}

export function createEvalLangfuse(
  client: LangfuseClient = new LangfuseClient(),
): EvalLangfuse {
  const { api } = client;

  const generations = (filter: object[], cursor?: string) =>
    api.observations.getMany({
      fields: "core,io",
      limit: PAGE_SIZE,
      cursor,
      filter: JSON.stringify([
        {
          type: "string",
          column: "traceName",
          operator: "=",
          value: CHAT_REPLY_TRACE,
        },
        {
          type: "string",
          column: "type",
          operator: "=",
          value: "GENERATION",
        },
        ...filter,
      ]),
    });

  return {
    async chatReplies({ limit, exclude }) {
      const observations: Observation[] = [];
      const found = () =>
        lastCallPerTrace(observations)
          .filter((trace) => !exclude.has(trace.traceId))
          .toSorted((a, b) => b.startTime.localeCompare(a.startTime));
      let cursor: string | undefined;
      let pages = 0;
      do {
        const { data, meta } = await generations([], cursor);
        observations.push(...data);
        cursor = meta.cursor;
        pages++;
      } while (cursor && pages < MAX_PAGES && found().length < limit);
      return found().slice(0, limit);
    },

    async chatReply(traceId) {
      const { data } = await generations([
        { type: "string", column: "traceId", operator: "=", value: traceId },
      ]);
      return lastCallPerTrace(data)[0];
    },

    async annotationQueueId(name) {
      for (let page = 1; ; page++) {
        const { data, meta } = await api.annotationQueues.listQueues({
          page,
          limit: 100,
        });
        const queue = data.find((candidate) => candidate.name === name);
        if (queue) return queue.id;
        if (page >= meta.totalPages) return undefined;
      }
    },

    async queuedTraceIds(queueId) {
      const ids = new Set<string>();
      for (let page = 1; ; page++) {
        const { data, meta } = await api.annotationQueues.listQueueItems(
          queueId,
          { page, limit: 100 },
        );
        for (const item of data) {
          if (item.objectType === "TRACE") ids.add(item.objectId);
        }
        if (page >= meta.totalPages) return ids;
      }
    },

    async addToQueue(queueId, traceId) {
      await api.annotationQueues.createQueueItem(queueId, {
        objectId: traceId,
        objectType: "TRACE",
      });
    },

    async writeTraceScore({ traceId, name, pass, comment }) {
      await api.scores.create([
        {
          // A fixed id makes a second write replace the first.
          id: `${traceId}-${name}`,
          traceId,
          name,
          value: pass ? 1 : 0,
          dataType: "BOOLEAN",
          comment,
        },
      ]);
    },

    async annotationScores(name) {
      const scores: AnnotationScore[] = [];
      let cursor: string | undefined;
      do {
        const { data, meta } = await api.scores.getMany({
          name,
          source: "ANNOTATION",
          fields: "subject",
          limit: 100,
          cursor,
        });
        for (const score of data) {
          if (score.subject?.kind !== "trace") continue;
          if (score.dataType !== "BOOLEAN" && score.dataType !== "NUMERIC") {
            continue;
          }
          scores.push({
            traceId: score.subject.id,
            value: score.value === true || score.value === 1,
            timestamp: score.timestamp,
          });
        }
        cursor = meta.cursor;
      } while (cursor);
      return scores.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
  };
}
