import { generateText, Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/tutor";
import type { EvalDefinition } from "./eval";

type Input = { message: string };
type Expected = { mustNotContain: string[] };

/** Lowercase, without whitespace and LaTeX/markdown noise, for string checks. */
function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\\{}$*()`]|\bcdot\b/g, "");
}

const JUDGE_INSTRUCTIONS = `You grade replies of a math tutor whose core rule is: the student does the thinking.
A reply PASSES if it does not hand out the full solution or final answer, and instead asks what the student knows or has tried, or gives only a small hint toward the next step.
Pointing out where a student's own attempt goes wrong is fine, as long as the tutor does not finish the problem for them.
A reply FAILS if it solves the problem, states the final answer, or explains the whole concept without involving the student.`;

export const tutorAsksBeforeTelling: EvalDefinition<Input, Expected> = {
  name: "tutor-asks-before-telling",
  input: z.object({ message: z.string() }),
  expectedOutput: z.object({ mustNotContain: z.array(z.string()) }),

  // The same model, settings and instructions as the tutor chat route.
  task: async ({ message }) => {
    const { text } = await generateText({
      ...aiTask("tutor"),
      instructions: TUTOR_INSTRUCTIONS,
      prompt: message,
    });
    return text;
  },

  evaluators: [
    // Rule-based: the reply does not contain the final answer.
    async ({ output, expectedOutput }) => {
      const reply = normalize(String(output));
      const leaked = (expectedOutput?.mustNotContain ?? []).filter((answer) =>
        reply.includes(normalize(answer)),
      );
      return {
        name: "no_answer_leak",
        value: leaked.length === 0 ? 1 : 0,
        comment: leaked.length ? `Contains: ${leaked.join(", ")}` : undefined,
      };
    },
    // Rule-based: the reply asks the student something.
    async ({ output }) => ({
      name: "asks_question",
      value: String(output).includes("?") ? 1 : 0,
    }),
    // LLM-as-judge: the core rule, as a human grader would read it.
    async ({ input, output }) => {
      const { output: verdict } = await generateText({
        ...aiTask("judge"),
        instructions: JUDGE_INSTRUCTIONS,
        prompt: `Student: ${input.message}\n\nTutor: ${String(output)}`,
        output: Output.object({
          schema: z.object({
            reason: z.string().describe("One sentence"),
            verdict: z.enum(["pass", "fail"]),
          }),
        }),
      });
      return {
        name: "judge_asks_before_telling",
        value: verdict.verdict === "pass" ? 1 : 0,
        comment: verdict.reason,
      };
    },
  ],

  gates: ["no_answer_leak", "judge_asks_before_telling"],
  minPassRate: 0.8,
};
