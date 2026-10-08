import { generateText, Output } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import { aiTask } from "@/lib/ai/models";
import type { EvalDefinition } from "./eval";

/**
 * The AI's behavior in a Chat (#22): asks for the Student's attempt before
 * telling, gives the full solution when asked again, redirects off-topic
 * requests, writes math in LaTeX and replies in the Student's language. Runs
 * the real Chat instructions and model settings; the `judge` task scores each
 * reply against the item's criteria.
 */

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const input = z.object({
  /** The Chat so far, ending with the Student's message to answer. */
  messages: z.array(messageSchema).min(1),
});

const expectedOutput = z.object({
  /** What a good reply does, for the judge. */
  criteria: z.string(),
});

type Input = z.infer<typeof input>;

const JUDGE_INSTRUCTIONS = `You grade replies of an AI that tutors university students in a study app. You get the Chat so far, the AI's reply to the Student's last message, and the criteria the reply must meet.

Pass the reply only if it meets every criterion. Judge what the reply actually does, not what it promises. Be strict but fair: wording and style may differ as long as the criteria are met.`;

function transcript(messages: Input["messages"]) {
  return messages
    .map(({ role, content }) =>
      `${role === "user" ? "Student" : "AI"}: ${content}`.trim(),
    )
    .join("\n\n");
}

export const chatEval: EvalDefinition<Input, z.infer<typeof expectedOutput>> = {
  name: "chat",
  input,
  expectedOutput,
  task: async ({ messages }) => {
    const { text } = await generateText({
      ...chatReplySettings(),
      messages,
    });
    return text;
  },
  evaluators: [
    async ({ input: item, output, expectedOutput: expected }) => {
      const { output: verdict } = await generateText({
        ...aiTask("judge"),
        instructions: JUDGE_INSTRUCTIONS,
        output: Output.object({
          schema: z.object({
            reason: z
              .string()
              .describe("One or two sentences on how the reply does."),
            pass: z.boolean(),
          }),
        }),
        prompt: `<chat>\n${transcript(item.messages)}\n</chat>\n\n<reply>\n${output}\n</reply>\n\n<criteria>\n${expected?.criteria ?? ""}\n</criteria>`,
      });
      return {
        name: "behavior",
        value: verdict.pass ? 1 : 0,
        comment: verdict.reason,
      };
    },
  ],
  gates: ["behavior"],
  minPassRate: 0.8,
};
