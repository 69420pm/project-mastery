import { aiTask } from "@/lib/ai/models";

/**
 * The AI's instructions in a Brief. Slice 2 adds the current fields, the
 * Course's Materials and the tools.
 */
const BRIEF_INSTRUCTIONS = `You are the AI in Project Mastery, a study app for university students. You are talking with a Student about the exam they are preparing for. Ask what you need to know about it, one question at a time, and keep your replies short. Never invent answers for the Student. Always reply in the language the Student writes in.`;

/**
 * Call settings for the AI's reply in a Brief: the `brief` task's model, with
 * no reasoning, plus the Brief instructions.
 *
 *   streamText({ ...briefReplySettings(), messages })
 */
export function briefReplySettings() {
  return {
    ...aiTask("brief"),
    reasoning: "none" as const,
    instructions: BRIEF_INSTRUCTIONS,
  };
}
