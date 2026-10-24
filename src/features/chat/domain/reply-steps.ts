import { getToolName, isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/features/chat/types";
import type {
  ExerciseView,
  GradedKc,
  KcReading,
  QuestionKind,
} from "@/features/study";

type Part = ChatUIMessage["parts"][number];

/**
 * Whether a tool call is still on its way, has returned, failed, or never
 * returned because the reply was stopped.
 */
type StepState = "running" | "done" | "error" | "stopped";

/** What a step card shows when it is expanded, by tool. */
export type StepDetail =
  | { tool: "readKcs"; kcs: KcReading[] }
  | { tool: "findExercises"; exercises: ExerciseView[]; note?: string }
  | { tool: "remember"; text: string }
  | { tool: "grade"; kcs: GradedKc[] }
  | { tool: "other"; input: unknown; output: unknown };

/** One tool call of an AI reply, as its step card shows it. */
export type ReplyStep = {
  id: string;
  /** The tool's name, such as `readKcs`. */
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

/**
 * A run of an AI reply's text, one of its tool calls, or a question it
 * asked, in reply order.
 */
export type ReplySegment =
  | { kind: "text"; text: string }
  | { kind: "step"; step: ReplyStep }
  | { kind: "question"; question: AskedQuestion };

/** What each tutor tool does, as a running or failed card names it. */
const TOOL_TITLES: Record<string, string> = {
  readKcs: "Reading KCs",
  findExercises: "Finding Exercises",
  remember: "Making a note",
  ask: "Asking a question",
  grade: "Grading your answer",
};

/**
 * An AI reply's parts as the Chat shows them, in order: each run of text as
 * one segment, each tool call as a step. Other parts, such as `step-start`,
 * show nothing. Once the reply is no longer in progress, a call that never
 * returned (the Student stopped the reply) shows as stopped, not running.
 */
export function replySegments(
  parts: ChatUIMessage["parts"],
  { inProgress }: { inProgress: boolean },
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
      segments.push(
        question
          ? { kind: "question", question }
          : { kind: "step", step: replyStep(part, inProgress) },
      );
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
  if (name === "readKcs" && Array.isArray(out.kcs)) {
    const kcs = out.kcs as KcReading[];
    return {
      summary: `Read ${count(kcs.length, "KC")}: ${kcs.map((kc) => kc.name).join(", ")}`,
      detail: { tool: "readKcs", kcs },
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
