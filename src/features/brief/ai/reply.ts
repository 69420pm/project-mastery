import { findingQuestion, reviewQueue } from "@/features/brief/domain/findings";
import {
  suggestedReservation,
  type BriefContext,
  type ExamMaterial,
} from "@/features/brief/domain/intake";
import { aiTask } from "@/lib/ai/models";

const ROLE = `You are the AI in Project Mastery, a study app for university students. You are talking with a Student about the exam they are preparing for, to learn what you need to plan their studying. Keep your replies short, and always reply in the language the Student writes in.`;

const FLOW = `Ask for the fixed answers in this order, one missing thing at a time:
1. the exam date
2. the goal: pass, a good grade, or master everything
3. the hours per week the Student can study
4. the format: written, multiple choice or mixed questions; open book or closed book; whether a formula sheet and a calculator are allowed
5. the scope: which of the Course's Materials the exam does not cover

The Student may answer several things in one message: store everything they answered, then ask for the next missing thing. Once the fixed answers are stored, ask about the rest in free text: hints from the teacher, what changed this year, what they already know and where they struggle.

Store each answer with a tool as soon as the Student gives it:
- saveBrief for the fixed answers. Send only what the Student just answered or changed. For the scope, send excludedMaterialIds with every excluded Material's id (an empty list when the exam covers all of them) and scopeConfirmed: true.
- addNote for everything else the Student says about the exam, in their own words.

Never invent or assume an answer the Student did not give: ask instead. When the Student changes an earlier answer, store the new one. Never show the Student the Materials' ids, field names or tool names.`;

const unanswered = "not answered";

function describeAnswers({ fields, notes }: BriefContext): string {
  const answer = (value: unknown) =>
    value === null ? unanswered : String(value);
  return [
    `- exam date: ${answer(fields.examDate)}`,
    `- goal: ${answer(fields.goal)}`,
    `- hours per week: ${answer(fields.hoursPerWeek)}`,
    `- question style: ${answer(fields.questionStyle)}`,
    `- open book: ${answer(fields.openBook)}`,
    `- formula sheet allowed: ${answer(fields.formulaSheet)}`,
    `- calculator allowed: ${answer(fields.calculator)}`,
    `- scope confirmed: ${fields.scopeConfirmed}`,
    `- notes: ${notes ?? "none yet"}`,
  ].join("\n");
}

function describeMaterials({ materials }: BriefContext): string {
  if (materials.length === 0) return "The Course has no Materials yet.";
  return materials
    .map(
      ({ id, name, excluded }) =>
        `- ${JSON.stringify(name)} (id ${id})${excluded ? ": excluded" : ""}`,
    )
    .join("\n");
}

function describeExam({ name, year, totalPoints }: ExamMaterial): string {
  return [
    JSON.stringify(name),
    year === null ? "year unknown" : `from ${year}`,
    totalPoints === null ? "total points unknown" : `${totalPoints} points`,
  ].join(", ");
}

const RESERVATION = `The reserved exam: the Student can keep one of the Course's old exams unseen, so that their final Mock exam is that real exam. You and the practice leave it out until then. Once the fixed answers are stored, and before anything else, ask whether they want to keep one aside and which, listing each old exam by its name, year and total points. Store the answer with saveBrief: reservedExamMaterialId with the exam's id, or "none" when they keep none.`;

function describeReservation(context: BriefContext): string | null {
  const { exams, reservedExam } = context;
  if (exams.length === 0) return null;
  const list = exams
    .map((exam) => `- ${describeExam(exam)} (id ${exam.id})`)
    .join("\n");
  return `${RESERVATION}\n\nThe Course's old exams:\n${list}\n\n${reservationAnswer(exams, reservedExam)}`;
}

function reservationAnswer(
  exams: ExamMaterial[],
  { answered, materialId }: BriefContext["reservedExam"],
): string {
  if (answered) {
    const kept = exams.find(({ id }) => id === materialId);
    return `Answered: keep ${kept ? JSON.stringify(kept.name) : "none"}. When the Student changes their mind, store the new answer.`;
  }
  const suggested = suggestedReservation(exams);
  return suggested
    ? `Not answered yet. Suggest keeping the most recent, ${JSON.stringify(suggested.name)}.`
    : "Not answered yet. With only one old exam, suggest keeping none, so that the Student can practise with it.";
}

const REVIEW = `Questions about the materials: the Course's Materials contain things only the Student can settle, such as a printed solution that does not match or a remark that limits what the exam covers. Ask them one at a time, each with its sources.
- When the Student answers the question you are asking, call answerFinding with its id and their answer word for word. Then, in the same reply, ask the question the tool result gives you, or tell the Student the questions about the materials are done when it says none are left.
- When the Student talks about something else, reply to that first, then ask the question again.
- Never answer a question for the Student, and never show them its id.`;

function describeReview({ findings }: BriefContext): string | null {
  const { asking, next } = reviewQueue(findings);
  if (!asking) return null;
  return [
    REVIEW,
    `The question you are asking now (id ${asking.id}):\n${findingQuestion(asking)}`,
    next
      ? `The next question (id ${next.id}):\n${findingQuestion(next)}`
      : "No question follows it.",
  ].join("\n\n");
}

/** The AI's instructions in a Brief, with what is stored so far. */
function briefInstructions(context: BriefContext): string {
  return [
    ROLE,
    FLOW,
    `What the Student has told you so far:\n${describeAnswers(context)}`,
    `The Course's Materials:\n${describeMaterials(context)}`,
    describeReservation(context),
    describeReview(context),
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ]
    .filter((section) => section !== null)
    .join("\n\n");
}

/**
 * Call settings for the AI's reply in a Brief: the `brief` task's model, with
 * no reasoning, plus the Brief instructions.
 *
 *   streamText({ ...briefReplySettings(context), messages, tools })
 */
export function briefReplySettings(context: BriefContext) {
  return {
    ...aiTask("brief"),
    reasoning: "none" as const,
    instructions: briefInstructions(context),
  };
}
