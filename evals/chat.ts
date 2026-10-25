import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { chatReplySettings } from "@/features/chat/server";
import {
  endsReply,
  tutorTools,
  type TutorContext,
  type TutorToolActions,
} from "@/features/study/server";
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

/**
 * A fixed tutor context from a small sample calculus map, so the eval runs
 * the instructions as a Chat in a Course with a map gets them. The tools
 * serve the sample map without sources: the items test behaviour, not the
 * course's sources.
 */
const SAMPLE_CONTEXT: TutorContext = {
  today: "2026-11-02",
  examDate: "2026-12-03",
  hasMap: true,
  phase: "build",
  goal: "good_grade",
  memory: "",
  mapPath: "/courses/00000000-0000-4000-8000-000000000000/map",
  dueReviews: { kcs: [], more: 0 },
  todayPlan: {
    next: {
      id: "topic-product-chain",
      name: "Product and chain rule",
      centralQuestion: "How do you differentiate products and compositions?",
      kcs: [
        {
          id: "kc-product-rule",
          name: "Product rule",
          type: "procedure",
          taught: false,
        },
        {
          id: "kc-chain-rule",
          name: "Chain rule",
          type: "procedure",
          taught: false,
        },
      ],
      anchors: [
        { id: "kc-power-rule", name: "Derivative of a power" },
        { id: "kc-function", name: "Composition of functions" },
      ],
    },
    hint: null,
    fitLine:
      "Build phase. At your pace, 9 of 12 Topics fit, covering 70% of exam weight.",
  },
};

const SAMPLE_KCS = [
  ...SAMPLE_CONTEXT.todayPlan.next!.kcs,
  ...SAMPLE_CONTEXT.todayPlan.next!.anchors.map((anchor) => ({
    ...anchor,
    type: "concept",
  })),
];

/** The most steps of a reply, as the tools let the AI read before writing. */
const MAX_STEPS = 5;

/**
 * The AI's reply as the Student sees it: its text, and the question card
 * when it asks one. Tools serve the sample map; a question is not stored.
 */
async function reply(messages: Input["messages"]): Promise<string> {
  const cards: string[] = [];
  const actions: TutorToolActions = {
    readKcs: async (kcIds) =>
      SAMPLE_KCS.filter((kc) => kcIds.includes(kc.id)).map((kc) => ({
        id: kc.id,
        name: kc.name,
        type: kc.type,
        description: kc.name,
        sources: [],
      })),
    findExercises: async () => ({
      exercises: [],
      note: "The Course has no Exercises on these KCs.",
    }),
    findReading: async () => null,
    remember: async () => {},
    ask: async ({ prompt }) => {
      cards.push(prompt);
      return `question-${cards.length}`;
    },
    findQuestion: async () => null,
    saveGrade: async () => null,
  };
  const { steps } = await generateText({
    ...chatReplySettings(SAMPLE_CONTEXT),
    messages,
    tools: tutorTools(actions),
    stopWhen: [isStepCount(MAX_STEPS), endsReply],
  });
  return [
    ...steps.map((step) => step.text),
    ...cards.map((prompt) => `[Question card]\n${prompt}`),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

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
  task: async ({ messages }) => reply(messages),
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
