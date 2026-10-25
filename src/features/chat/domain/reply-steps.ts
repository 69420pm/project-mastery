import { getToolName, isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/features/chat/types";
import {
  isStage,
  STAGE_NAMES,
  type ExerciseView,
  type GradedKc,
  type QuestionKind,
  type Stage,
  type TopicView,
} from "@/features/study";

type Part = ChatUIMessage["parts"][number];

/**
 * Whether a tool call is still on its way, has returned, failed, or never
 * returned because the reply was stopped.
 */
type StepState = "running" | "done" | "error" | "stopped";

/** What a step card shows when it is expanded, by tool. */
export type StepDetail =
  | { tool: "getTopic"; topic: TopicView }
  | { tool: "findExercises"; exercises: ExerciseView[]; note?: string }
  | { tool: "remember"; text: string }
  | { tool: "grade"; kcs: GradedKc[] }
  | { tool: "other"; input: unknown; output: unknown };

/** One tool call of an AI reply, as its step card shows it. */
export type ReplyStep = {
  id: string;
  /** The tool's name, such as `getTopic`. */
  name: string;
  state: StepState;
  /** The card's one line. */
  summary: string;
  /** The error the AI got back, for a failed call. */
  errorText?: string;
  /** Null until the call has returned. */
  detail: StepDetail | null;
};

/** A question the AI asked, as its question card shows it. */
export type AskedQuestion = {
  id: string;
  kind: QuestionKind;
  /** Markdown with LaTeX. */
  prompt: string;
};

/** A Reading section the AI opened, as its reading card shows it. */
export type ShownReading = {
  /** The `showReading` call's id, which tells the cards apart. */
  id: string;
  sectionId: string;
  /** Such as "Lecture 3, pp. 12–14". */
  label: string;
  /** The question the Student reads it for. */
  purpose: string;
};

/**
 * A run of an AI reply's text, one of its tool calls, or a question it
 * asked or a reading it opened, in reply order.
 */
export type ReplySegment =
  | { kind: "text"; text: string }
  | { kind: "step"; step: ReplyStep }
  | { kind: "question"; question: AskedQuestion }
  | { kind: "reading"; reading: ShownReading }
  | { kind: "knowledgeMap"; knowledgeMap: KnowledgeMapReveal };

/**
 * A graded rebuild, whose Knowledge map card opens the Topic's part of the
 * Knowledge map.
 */
export type KnowledgeMapReveal = {
  /** The `grade` call's id, which tells the cards apart. */
  id: string;
  topicId: string;
};

/** What each tutor tool does, as a running or failed card names it. */
const TOOL_TITLES: Record<string, string> = {
  getTopic: "Reading the Topic",
  findExercises: "Finding Exercises",
  remember: "Making a note",
  ask: "Asking a question",
  showReading: "Opening a reading",
  grade: "Grading your answer",
  setStage: "Moving on",
};

/**
 * An AI reply's parts as the Chat shows them, in order: each run of text as
 * one segment, each tool call as a step. Other parts, such as `step-start`,
 * show nothing. Once the reply is no longer in progress, a call that never
 * returned (the Student stopped the reply) shows as stopped, not running.
 * A `grade` of a question in `rebuilds` is followed by a Knowledge map of
 * `topicId`, when the session has a Topic.
 */
export function replySegments(
  parts: ChatUIMessage["parts"],
  {
    inProgress,
    rebuilds = new Set(),
    topicId = null,
  }: {
    inProgress: boolean;
    /** The Chat's rebuild questions (`rebuildQuestions`). */
    rebuilds?: Set<string>;
    /** The session's Topic (`sessionTopic`). */
    topicId?: string | null;
  },
): ReplySegment[] {
  const segments: ReplySegment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const last = segments.at(-1);
      if (last?.kind === "text") last.text += part.text;
      else if (part.text !== "")
        segments.push({ kind: "text", text: part.text });
    } else if (isToolUIPart(part)) {
      const question = askedQuestion(part);
      const reading = shownReading(part);
      segments.push(
        question
          ? { kind: "question", question }
          : reading
            ? { kind: "reading", reading }
            : { kind: "step", step: replyStep(part, inProgress) },
      );
      const graded = gradedQuestion(part);
      if (topicId !== null && graded !== null && rebuilds.has(graded)) {
        segments.push({
          kind: "knowledgeMap",
          knowledgeMap: { id: part.toolCallId, topicId },
        });
      }
    }
  }
  return segments;
}

type ToolPart = Extract<Part, { toolCallId: string }>;

/** The question of an `ask` call that stored it; null for any other part. */
function askedQuestion(part: ToolPart): AskedQuestion | null {
  if (getToolName(part) !== "ask" || part.state !== "output-available") {
    return null;
  }
  const input = asRecord(part.input);
  const output = asRecord(part.output);
  if (typeof output.questionId !== "string") return null;
  return {
    id: output.questionId,
    kind: input.kind as QuestionKind,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
  };
}

/** The question a `grade` call that returned graded; null for any other part. */
function gradedQuestion(part: ToolPart): string | null {
  if (getToolName(part) !== "grade" || part.state !== "output-available") {
    return null;
  }
  const { questionId } = asRecord(part.input);
  return typeof questionId === "string" ? questionId : null;
}

/** The ids of a Chat's questions of kind `rebuild`. */
export function rebuildQuestions(messages: ChatUIMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const question = askedQuestion(part);
      if (question?.kind === "rebuild") ids.add(question.id);
    }
  }
  return ids;
}

/**
 * A Chat's learn session's Topic, from its latest reply's tutor context: the
 * Topic of today's work while the context has a session. Null without one.
 */
export function sessionTopic(messages: ChatUIMessage[]): string | null {
  const context = messages.findLast((message) => message.metadata?.tutorContext)
    ?.metadata?.tutorContext;
  return context?.session ? (context.todayPlan.next?.id ?? null) : null;
}

/** The reading of a `showReading` call that returned; null for any other part. */
function shownReading(part: ToolPart): ShownReading | null {
  if (
    getToolName(part) !== "showReading" ||
    part.state !== "output-available"
  ) {
    return null;
  }
  const input = asRecord(part.input);
  const output = asRecord(part.output);
  if (typeof input.sectionId !== "string") return null;
  return {
    id: part.toolCallId,
    sectionId: input.sectionId,
    label: typeof output.label === "string" ? output.label : "",
    purpose: typeof input.purpose === "string" ? input.purpose : "",
  };
}

/**
 * The reading cards of a Chat that are done, by `showReading` call id: a
 * card is done once a later Student message names its section, as Done
 * sends it. A side message leaves it open.
 */
export function doneReadings(messages: ChatUIMessage[]): Set<string> {
  const done = new Set<string>();
  // Open cards by section id.
  const open = new Map<string, string[]>();
  for (const message of messages) {
    const read = message.metadata?.readingSectionId;
    if (message.role === "user" && read) {
      for (const id of open.get(read) ?? []) done.add(id);
      open.delete(read);
    }
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const reading = shownReading(part);
      if (reading) {
        open.set(reading.sectionId, [
          ...(open.get(reading.sectionId) ?? []),
          reading.id,
        ]);
      }
    }
  }
  return done;
}

/**
 * Where each question of a Chat stands, by question id, read from its
 * messages: submitted once a Student's message answers it from its card
 * (the latest answer counts), graded once a `grade` call returned for it.
 * A question missing here is open.
 */
export function questionStates(
  messages: ChatUIMessage[],
): Map<string, QuestionState> {
  const states = new Map<string, QuestionState>();
  for (const message of messages) {
    const questionId = message.metadata?.questionId;
    if (message.role === "user" && questionId) {
      states.set(questionId, { status: "submitted" });
    }
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== "grade" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const graded = asRecord(part.input).questionId;
      const kcs = asRecord(part.output).kcs;
      if (typeof graded === "string" && Array.isArray(kcs)) {
        states.set(graded, { status: "graded", kcs: kcs as GradedKc[] });
      }
    }
  }
  return states;
}

/**
 * Where a Chat's learn session stands, read from its messages: the stage of
 * the latest `setStage` call that returned, or else of the latest reply's
 * tutor context. Null for a session without stages.
 */
export function sessionStage(messages: ChatUIMessage[]): Stage | null {
  let stage: Stage | null = null;
  for (const message of messages) {
    const context = message.metadata?.tutorContext;
    if (context) stage = context.session?.stage ?? null;
    for (const part of message.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === "setStage" &&
        part.state === "output-available"
      ) {
        const moved = asRecord(part.output).stage;
        if (isStage(moved)) stage = moved;
      }
    }
  }
  return stage;
}

/** A question's state on its question card, once it is no longer open. */
export type QuestionState =
  { status: "submitted" } | { status: "graded"; kcs: GradedKc[] };

/** One tool call as its card shows it. */
function replyStep(part: ToolPart, inProgress = true): ReplyStep {
  const name = getToolName(part);
  const base = { id: part.toolCallId, name };
  const title = TOOL_TITLES[name] ?? name;
  if (part.state === "output-error" || part.state === "output-denied") {
    return {
      ...base,
      state: "error",
      summary: `${title} failed`,
      errorText:
        part.state === "output-error" ? part.errorText : "The call was denied.",
      detail: null,
    };
  }
  if (part.state !== "output-available") {
    return inProgress
      ? { ...base, state: "running", summary: `${title}…`, detail: null }
      : {
          ...base,
          state: "stopped",
          summary: `${title} stopped`,
          detail: null,
        };
  }
  const { summary, detail } = describeOutput(name, part.input, part.output);
  return { ...base, state: "done", summary, detail };
}

function describeOutput(
  name: string,
  input: unknown,
  output: unknown,
): { summary: string; detail: StepDetail } {
  const out = asRecord(output);
  const args = asRecord(input);
  if (name === "getTopic" && Array.isArray(out.kcs)) {
    const topic = out as unknown as TopicView;
    return {
      summary:
        topic.name === null ? "Read the KCs" : `Read Topic ${topic.name}`,
      detail: { tool: "getTopic", topic },
    };
  }
  if (name === "findExercises" && Array.isArray(out.exercises)) {
    const exercises = out.exercises as ExerciseView[];
    const note = typeof out.note === "string" ? out.note : undefined;
    return {
      summary:
        exercises.length === 0 && note
          ? note
          : `Found ${count(exercises.length, "Exercise")}`,
      detail: { tool: "findExercises", exercises, note },
    };
  }
  if (name === "grade" && Array.isArray(out.kcs)) {
    const kcs = out.kcs as GradedKc[];
    return {
      summary: `Graded: ${kcs.map((kc) => `${kc.name} ${kc.result}`).join(", ")}`,
      detail: { tool: "grade", kcs },
    };
  }
  if (name === "setStage" && isStage(out.stage)) {
    return {
      summary: `Moved to ${STAGE_NAMES[out.stage]}`,
      detail: { tool: "other", input, output },
    };
  }
  if (name === "remember" && typeof args.text === "string") {
    return {
      summary: `Noted: ${args.text}`,
      detail: { tool: "remember", text: args.text },
    };
  }
  return { summary: name, detail: { tool: "other", input, output } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
