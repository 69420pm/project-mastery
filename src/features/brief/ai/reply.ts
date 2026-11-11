import {
  suggestedReservation,
  type BriefContext,
  type ExamChapter,
} from "@/features/brief/domain/intake";
import { aiTask } from "@/lib/ai/models";

const ROLE = `You are the AI in Project Mastery, a study app for university students. You are talking with a Student about the exam they are preparing for, to learn what you need to plan their studying. Keep your replies short, and always reply in the language the Student writes in.`;

const flow = (
  mapPath: string,
) => `The Brief is a short conversation. Ask in these batches, in this order, each batch as one message, leaving out what is already stored:
1. the exam date and the goal: pass, a good grade, or master everything. The conversation's first message already asked this.
2. the format: open book or closed book, and whether a formula sheet and a calculator are allowed
3. the scope: which of the Course's Materials the exam does not cover; which Materials, or which Chapters inside them, are old exams, proposing the Chapters marked as likely old exams by name ("<Material> › <Chapter>"); and whether the exam leaves out or stresses a Topic, but only when an admin text or the Student says so
4. the reserved exam, right after the old exams are stored, and only if the Course has any
5. one open question: hints from the teacher, what changed this year, what they already know and where they struggle

Ask each question once. Read the conversation to see what you already asked. The Student may answer several things in one message: store everything they answered, then ask the next batch. When the Student does not know or skips something, move on and do not ask it again unless they bring it up; store nothing for it. Ask in plain text, without forms or numbered answer options.

Once the Student has answered or declined the open question, close the Brief in a short message, and ask nothing more: the Brief is done, they start learning in a new Chat, linked from the Course map with its Today card (link to it as [Course map](${mapPath})), and they can come back here any time with new information. After that close, when the Student tells you something new, store it, confirm it in one line, and ask no question.

Store each answer with a tool as soon as the Student gives it, and only once.
- saveBrief for the fixed answers, in one call per reply that holds everything the Student just answered or changed. For the excluded Materials, send excludedMaterialIds with every excluded Material's id (an empty list when the exam covers all of them). For the old exams, send examChapterIds with the id of every Chapter that is an old exam, including those already marked (an empty list when none is): a Material's top Chapter when the whole Material is one, else the Chapter that holds the exam. Once you have asked the scope questions, send scopeConfirmed: true, also when the Student answered that they don't know. When the Student asks for their Knowledge map in another language than the Course language, send courseLanguage.
- setExamScope when the exam leaves out or stresses one Topic; pick the highest Topic that covers what the exam leaves out or stresses. Propose it only when an admin text or the Student says so, and store it only after the Student has confirmed it: words quotes their confirmation verbatim. Send scope null to remove one the Student takes back.
- addNote for anything else the Student says about the exam: one note per new fact. Check the stored notes below first: a fact they or saveBrief's fields already hold needs no note. Write each note as a neutral third-person paraphrase in their language that keeps every concrete fact (names, chapters, numbers, a teacher's hint), for example "New to linear algebra; no prior knowledge." Never copy their words.

Never invent or assume an answer the Student did not give. When the Student changes an earlier answer, store the new one. Never show the Student the ids, field names or tool names.`;

const unanswered = "not answered";

function describeAnswers({ fields, notes }: BriefContext): string {
  const answer = (value: unknown) =>
    value === null ? unanswered : String(value);
  return [
    `- exam date: ${answer(fields.examDate)}`,
    `- goal: ${answer(fields.goal)}`,
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
    .map(({ id, name, excluded, chapters }) => {
      const material = `- ${JSON.stringify(name)} (id ${id})${excluded ? ": excluded" : ""}`;
      const outline = chapters.map((chapter) => {
        const mark =
          chapter.exam === true
            ? "old exam"
            : chapter.exam === false
              ? "not an old exam"
              : chapter.proposed && "likely an old exam";
        const title =
          chapter.depth === 0 ? "(top Chapter)" : JSON.stringify(chapter.title);
        return `${"  ".repeat(chapter.depth + 1)}- ${title} (chapter id ${chapter.id})${mark ? `: ${mark}` : ""}`;
      });
      return [material, ...outline].join("\n");
    })
    .join("\n");
}

function describeLanguage({ language }: BriefContext): string {
  return language.chosen
    ? `The Course language, which the Knowledge map is written in: ${language.name}, as the Student asked.`
    : `The Course language, which the Knowledge map is written in: ${language.name}, the Materials' own. The Student may ask for another.`;
}

function describeTopics({ topics, examScopes }: BriefContext): string {
  if (topics.length === 0) {
    return "The Course has no Knowledge map yet, so no exam scope can be stored.";
  }
  const scopeOf = (topicId: string) => {
    const scope = examScopes.find((s) => s.topicId === topicId);
    return scope ? ` [${scope.scope}: ${JSON.stringify(scope.words)}]` : "";
  };
  return topics
    .map(
      ({ id, name, depth }) =>
        `${"  ".repeat(depth)}- ${JSON.stringify(name)} (id ${id})${scopeOf(id)}`,
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

const RESERVATION = `The reserved exam: the Student can keep one of the Course's old exams unseen, so that their final Mock exam is that real exam. You and the practice leave it out until then. Right after the old exams are stored, before the open question, ask once whether they want to keep one aside and which, listing each old exam by its name. Store the answer with saveBrief: reservedExamChapterId with the exam's id, or the word none when they keep none. The reserved exam is one of the old exams, so when the same call sends examChapterIds, include it there.`;

function describeReservation(context: BriefContext): string | null {
  const { exams, reservedExam } = context;
  if (exams.length === 0) return null;
  const list = exams
    .map((exam) => `- ${JSON.stringify(exam.name)} (id ${exam.id})`)
    .join("\n");
  return `${RESERVATION}\n\nThe Course's old exams:\n${list}\n\n${reservationAnswer(exams, reservedExam)}`;
}

function reservationAnswer(
  exams: ExamChapter[],
  { answered, chapterId }: BriefContext["reservedExam"],
): string {
  if (answered) {
    const kept = exams.find(({ id }) => id === chapterId);
    return `Answered: keep ${kept ? JSON.stringify(kept.name) : "none"}. When the Student changes their mind, store the new answer.`;
  }
  const suggested = suggestedReservation(exams);
  return suggested
    ? `Not answered yet. Suggest keeping the latest, ${JSON.stringify(suggested.name)}.`
    : "Not answered yet. With only one old exam, suggest keeping none, so that the Student can practise with it.";
}

/** The AI's instructions in a Brief, with what is stored so far. */
function briefInstructions(context: BriefContext, mapPath: string): string {
  return [
    ROLE,
    flow(mapPath),
    `What the Student has told you so far:\n${describeAnswers(context)}`,
    `The Course's Materials, each with its Chapters:\n${describeMaterials(context)}`,
    describeLanguage(context),
    `The Course's Topics, nested, with any stored exam scope (a Topic's scope covers the Topics inside it):\n${describeTopics(context)}`,
    describeAdminTexts(context),
    describeReservation(context),
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ]
    .filter((section) => section !== null)
    .join("\n\n");
}

/**
 * How long one model call of a Brief reply may take. A step takes seconds;
 * one that ran 3.5 minutes wrote 36 tool calls, and its reply came after
 * the Student had moved on. A step that times out fails the reply, so the
 * Student sees the error and can retry.
 */
export const STEP_TIMEOUT_MS = 90_000;

/**
 * Call settings for the AI's reply in a Brief: the `brief` task's model, with
 * no reasoning and a time limit per step, plus the Brief instructions.
 * `mapPath` is the Course map's path, which the close links to.
 *
 *   streamText({ ...briefReplySettings(context, mapPath), messages, tools })
 */
export function briefReplySettings(context: BriefContext, mapPath: string) {
  return {
    ...aiTask("brief"),
    reasoning: "none" as const,
    timeout: { stepMs: STEP_TIMEOUT_MS },
    instructions: briefInstructions(context, mapPath),
  };
}
