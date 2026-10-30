import { isLikelyExam } from "@/features/brief/domain/old-exams";
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
5. the scope, in three questions: which of the Course's Materials the exam does not cover; which Materials are old exams, proposing those marked as likely old exams; and whether the exam leaves out or stresses a Big idea or Topic, but only when an admin text or the Student says so

The Student may answer several things in one message: store everything they answered, then ask for the next missing thing. Once the fixed answers are stored, ask about the rest in free text: hints from the teacher, what changed this year, what they already know and where they struggle.

Store each answer with a tool as soon as the Student gives it:
- saveBrief for the fixed answers. Send only what the Student just answered or changed. For the excluded Materials, send excludedMaterialIds with every excluded Material's id (an empty list when the exam covers all of them). For the old exams, send examMaterialIds with every old exam's id, including those already marked (an empty list when none is). Once all three scope questions are answered, send scopeConfirmed: true.
- setExamScope when the exam leaves out or stresses one Big idea or Topic. Propose it only when an admin text or the Student says so, and store it only after the Student has confirmed it: words quotes their confirmation verbatim. Send scope null to remove one the Student takes back.
- addNote for everything else the Student says about the exam, in their own words.

Never invent or assume an answer the Student did not give: ask instead. When the Student changes an earlier answer, store the new one. Never show the Student the ids, field names or tool names.`;

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
    .map(({ id, name, excluded, exam, examAsked }) => {
      const marks = [
        excluded && "excluded",
        exam
          ? "old exam"
          : examAsked
            ? "not an old exam"
            : isLikelyExam(name) && "likely an old exam by its name",
      ].filter(Boolean);
      const suffix = marks.length > 0 ? `: ${marks.join(", ")}` : "";
      return `- ${JSON.stringify(name)} (id ${id})${suffix}`;
    })
    .join("\n");
}

function describeBigIdeas({ bigIdeas, examScopes }: BriefContext): string {
  if (bigIdeas.length === 0) {
    return "The Course has no Knowledge map yet, so no exam scope can be stored.";
  }
  const scopeOf = (bigIdeaId: string | null, topicId: string | null) => {
    const scope = examScopes.find(
      (s) =>
        (bigIdeaId !== null && s.bigIdeaId === bigIdeaId) ||
        (topicId !== null && s.topicId === topicId),
    );
    return scope ? ` [${scope.scope}: ${JSON.stringify(scope.words)}]` : "";
  };
  return bigIdeas
    .map(({ id, name, topics }) =>
      [
        `- Big idea ${JSON.stringify(name)} (id ${id})${scopeOf(id, null)}`,
        ...topics.map(
          (topic) =>
            `  - Topic ${JSON.stringify(topic.name)} (id ${topic.id})${scopeOf(null, topic.id)}`,
        ),
      ].join("\n"),
    )
    .join("\n");
}

function describeAdminTexts({ adminTexts }: BriefContext): string | null {
  if (adminTexts.length === 0) return null;
  const list = adminTexts
    .map(({ text, source }) => `- ${source}: ${JSON.stringify(text)}`)
    .join("\n");
  return `Organizational remarks in the Materials (admin texts), such as what the exam covers:\n${list}`;
}

const RESERVATION = `The reserved exam: the Student can keep one of the Course's old exams unseen, so that their final Mock exam is that real exam. You and the practice leave it out until then. Once the fixed answers are stored, and before anything else, ask whether they want to keep one aside and which, listing each old exam by its name. Store the answer with saveBrief: reservedExamMaterialId with the exam's id, or "none" when they keep none.`;

function describeReservation(context: BriefContext): string | null {
  const { exams, reservedExam } = context;
  if (exams.length === 0) return null;
  const list = exams
    .map((exam) => `- ${JSON.stringify(exam.name)} (id ${exam.id})`)
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
    ? `Not answered yet. Suggest keeping the latest, ${JSON.stringify(suggested.name)}.`
    : "Not answered yet. With only one old exam, suggest keeping none, so that the Student can practise with it.";
}

/** The AI's instructions in a Brief, with what is stored so far. */
function briefInstructions(context: BriefContext): string {
  return [
    ROLE,
    FLOW,
    `What the Student has told you so far:\n${describeAnswers(context)}`,
    `The Course's Materials:\n${describeMaterials(context)}`,
    `The Course's Big ideas and Topics, with any stored exam scope:\n${describeBigIdeas(context)}`,
    describeAdminTexts(context),
    describeReservation(context),
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
