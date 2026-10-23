import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { aiTask } from "@/lib/ai/models";
import type { ChatReplyTrace } from "./langfuse";

/**
 * A judge criterion is a rubric file `evals/judges/<criterion>.md`; a judge
 * model reads one traced Chat reply against it and gives a pass/fail verdict
 * with a reason.
 */

const RUBRICS_DIR = path.join("evals", "judges");

export type Verdict = { pass: boolean; reason: string };

/** What a judge reads: the Chat before the reply, and the reply. */
export type ChatTranscript = {
  messages: { role: "user" | "assistant"; text: string }[];
  reply: string;
};

/** The Chat before the reply is cut to its last messages, to bound cost. */
const MAX_MESSAGES = 12;

/** The rubric of `criterion`; `pnpm evals` runs from the repository root. */
export async function loadRubric(criterion: string): Promise<string> {
  const available = (await readdir(RUBRICS_DIR))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length));
  if (!available.includes(criterion)) {
    throw new Error(
      `Unknown judge criterion: ${criterion}. Available: ${available.join(", ")}`,
    );
  }
  return readFile(path.join(RUBRICS_DIR, `${criterion}.md`), "utf8");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The text of a message's content in the shapes Langfuse stores: a string,
 * AI SDK parts (`{ type: "text", text }`) or OpenTelemetry GenAI parts
 * (`{ type: "text", content }`). Tool calls and files have no text.
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => isRecord(part) && part.type === "text")
      .map((part) => textOf(part.text ?? part.content))
      .filter(Boolean)
      .join("\n");
  }
  if (isRecord(content)) return textOf(content.parts ?? content.content);
  return "";
}

function messagesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.messages)) return value.messages;
  return [];
}

function chatMessage(
  message: unknown,
): ChatTranscript["messages"][number] | undefined {
  if (!isRecord(message)) return undefined;
  const { role } = message;
  if (role !== "user" && role !== "assistant") return undefined;
  const text = textOf(message.parts ?? message.content);
  return text ? { role, text } : undefined;
}

function replyText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map(chatMessage)
      .filter((message) => message?.role === "assistant")
      .map((message) => message!.text)
      .join("\n");
  }
  if (isRecord(output) && typeof output.text === "string") {
    return output.text.trim();
  }
  return textOf(output);
}

/**
 * The transcript of a traced Chat reply, or undefined when the trace has no
 * reply text, such as a stopped reply.
 */
export function chatTranscript(
  trace: Pick<ChatReplyTrace, "input" | "output">,
): ChatTranscript | undefined {
  const reply = replyText(trace.output);
  if (!reply) return undefined;
  const messages = messagesOf(trace.input)
    .map(chatMessage)
    .filter((message) => message !== undefined);
  return { messages: messages.slice(-MAX_MESSAGES), reply };
}

const JUDGE_INSTRUCTIONS = `You judge one reply of an AI that tutors university students in a study app, against one criterion. You get the Chat before the reply and the reply. Judge what the reply actually does, not what it promises. Be strict but fair.

The criterion:

`;

/** Settings of one judge model, as `aiTask` or `aiTaskCandidate` give them. */
export type JudgeSettings = ReturnType<typeof aiTask>;

/** One judge call: the verdict of the model in `settings` on `transcript`. */
export async function judgeReply(
  settings: JudgeSettings,
  rubric: string,
  transcript: ChatTranscript,
): Promise<Verdict> {
  const chat = transcript.messages
    .map(({ role, text }) => `${role === "user" ? "Student" : "AI"}: ${text}`)
    .join("\n\n");
  const { output } = await generateText({
    ...settings,
    instructions: JUDGE_INSTRUCTIONS + rubric,
    output: Output.object({
      schema: z.object({
        reason: z
          .string()
          .describe("One or two sentences on why the reply passes or fails."),
        pass: z.boolean(),
      }),
    }),
    prompt: `<chat>\n${chat}\n</chat>\n\n<reply>\n${transcript.reply}\n</reply>`,
  });
  return output;
}
