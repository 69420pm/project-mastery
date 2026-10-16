import { getToolName, isToolUIPart } from "ai";
import type { ChatUIMessage } from "@/features/chat/types";
import type { ExerciseView, KcReading, RecordedKc } from "@/features/study";

type Part = ChatUIMessage["parts"][number];

/** Whether a tool call is still on its way, has returned, or failed. */
export type StepState = "running" | "done" | "error";

/** What a step card shows when it is expanded, by tool. */
export type StepDetail =
  | { tool: "readKcs"; kcs: KcReading[] }
  | { tool: "findExercises"; exercises: ExerciseView[]; note?: string }
  | {
      tool: "recordAttempt";
      /** The Exercise's name, or its id when the reply never showed it. */
      exercise?: string;
      kcs: Array<RecordedKc & { correct?: boolean }>;
    }
  | { tool: "remember"; text: string }
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

/** A run of an AI reply's text, or one of its tool calls, in reply order. */
export type ReplySegment =
  { kind: "text"; text: string } | { kind: "step"; step: ReplyStep };

/** What each tutor tool does, as a running or failed card names it. */
const TOOL_TITLES: Record<string, string> = {
  readKcs: "Reading KCs",
  findExercises: "Finding Exercises",
  recordAttempt: "Recording an attempt",
  remember: "Making a note",
};

const HELP_LABELS: Record<string, string> = {
  none: "no help",
  some: "some help",
  solution_shown: "solution shown",
};

/**
 * An AI reply's parts as the Chat shows them, in order: each run of text as
 * one segment, each tool call as a step. Other parts, such as `step-start`,
 * show nothing.
 */
export function replySegments(parts: ChatUIMessage["parts"]): ReplySegment[] {
  const segments: ReplySegment[] = [];
  // Exercise names from earlier findExercises calls, for recordAttempt.
  const exerciseNames = new Map<string, string>();
  for (const part of parts) {
    if (part.type === "text") {
      const last = segments.at(-1);
      if (last?.kind === "text") last.text += part.text;
      else if (part.text !== "")
        segments.push({ kind: "text", text: part.text });
    } else if (isToolUIPart(part)) {
      const step = replyStep(part, exerciseNames);
      if (step.detail?.tool === "findExercises") {
        for (const { id, name } of step.detail.exercises) {
          exerciseNames.set(id, name);
        }
      }
      segments.push({ kind: "step", step });
    }
  }
  return segments;
}

type ToolPart = Extract<Part, { toolCallId: string }>;

/** One tool call as its card shows it. */
export function replyStep(
  part: ToolPart,
  exerciseNames: ReadonlyMap<string, string> = new Map(),
): ReplyStep {
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
    return { ...base, state: "running", summary: `${title}…`, detail: null };
  }
  const { summary, detail } = describeOutput(
    name,
    part.input,
    part.output,
    exerciseNames,
  );
  return { ...base, state: "done", summary, detail };
}

function describeOutput(
  name: string,
  input: unknown,
  output: unknown,
  exerciseNames: ReadonlyMap<string, string>,
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
  if (name === "recordAttempt" && Array.isArray(out.kcs)) {
    const attempted = Array.isArray(args.kcs)
      ? (args.kcs as Array<{ kcId: string; correct: boolean }>)
      : [];
    const kcs = (out.kcs as RecordedKc[]).map((kc) => ({
      ...kc,
      correct: attempted.find(({ kcId }) => kcId === kc.id)?.correct,
    }));
    const results = kcs
      .map(({ name, correct }) =>
        correct === undefined ? name : `${name} ${correct ? "✓" : "✗"}`,
      )
      .join(", ");
    const help = HELP_LABELS[String(args.help)];
    const exerciseId =
      typeof args.exerciseId === "string" ? args.exerciseId : undefined;
    return {
      summary: `Recorded: ${results}${help ? ` · ${help}` : ""}`,
      detail: {
        tool: "recordAttempt",
        exercise: exerciseId && (exerciseNames.get(exerciseId) ?? exerciseId),
        kcs,
      },
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
