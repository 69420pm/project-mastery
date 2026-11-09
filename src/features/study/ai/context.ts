import type {
  ContextKc,
  ProposedTopic,
  TutorContext,
} from "@/features/study/types";

/**
 * The tutor context as the model reads it (#251): a block of facts in front
 * of the newest Student message, so the instructions and the earlier
 * history stay the same from reply to reply and can be cached. Ids follow
 * the words "KC id", "Topic id", "section id" and "problem id".
 */

/** The tag the block opens with; the mock models skip it. */
export const CONTEXT_TAG = "tutor-context";

const GOALS = {
  pass: "to pass",
  good_grade: "a good grade",
  master_everything: "to master everything",
} as const;

const STATUS = {
  in_plan: "in plan",
  if_time_allows: "if time allows",
  skipped: "skipped",
} as const;

const percent = (value: number) => `${Math.round(value * 100)}%`;

const kcLine = (kc: ContextKc) =>
  `${kc.name} (KC id ${kc.id}; ${kc.band}${kc.recallToday === null ? "" : `, recall ${percent(kc.recallToday)}`})`;

const list = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");

/** The tutor context as one block of text. */
export function renderTutorContext(context: TutorContext): string {
  const sections = [
    dates(context),
    ["## This session", session(context)].join("\n"),
    ["## Proposal", proposal(context)].join("\n"),
    ...(context.practice.length > 0
      ? [
          [
            "## Practice candidates (taught, not due)",
            list(context.practice.map(kcLine)),
          ].join("\n"),
        ]
      : []),
    [
      "## Topics",
      context.topics.length === 0
        ? "The Course has no Topics yet."
        : list(
            context.topics.map(
              (topic) =>
                `${topic.name} (Topic id ${topic.id}): ${STATUS[topic.status]}, ${topic.learned} of ${topic.total} learned`,
            ),
          ),
    ].join("\n"),
    ...notes(context),
    ...mock(context),
  ];
  return `<${CONTEXT_TAG}>\n${sections.join("\n\n")}\n</${CONTEXT_TAG}>`;
}

function dates({ today, examDate, daysLeft, goal }: TutorContext): string {
  const exam =
    examDate === null
      ? "The exam date is not set."
      : daysLeft !== null && daysLeft < 0
        ? `The exam was on ${examDate}.`
        : `The exam is on ${examDate}, in ${daysLeft} days.`;
  const aim =
    goal === null
      ? "The goal is not set."
      : `The Student's goal is ${GOALS[goal]}.`;
  return `Today is ${today}. ${exam} ${aim}`;
}

function session({ session: s }: TutorContext): string {
  const lines = [
    `Running for ${s.minutes} minutes.`,
    s.checkedToday.length === 0
      ? "No KC checked today."
      : `Checked today: ${s.checkedToday
          .map(
            (kc) =>
              `${kc.name} (KC id ${kc.id}): ${kc.result}, help ${kc.help}`,
          )
          .join("; ")}.`,
    ...(s.minutesSinceGraded === null
      ? []
      : [`Last graded Question ${s.minutesSinceGraded} minutes ago.`]),
    ...(s.openQuestion
      ? [
          `Open Question, ${s.openQuestion.answered ? "answered, to grade" : "not answered"}, on ${s.openQuestion.kcs
            .map((kc) => `${kc.name} (KC id ${kc.id})`)
            .join(", ")}:\n${quote(s.openQuestion.prompt)}`,
        ]
      : []),
    ...(s.readings.length > 0
      ? [
          `Reading sections opened: ${s.readings
            .map((r) => `${r.label} (section id ${r.id})`)
            .join("; ")}.`,
        ]
      : []),
  ];
  return list(lines);
}

function proposal({ proposal: p }: TutorContext): string {
  if (p.finalStretch) {
    if (p.items.length === 0) return "Nothing in the plan to propose.";
    return [
      "The final stretch: everything ranks together, best first.",
      list(
        p.items.map((item) =>
          item.kind === "topic"
            ? `Topic: ${item.name} (Topic id ${item.id})`
            : `${item.kind === "review" ? "Review" : "Refresh"}: ${item.name} (KC id ${item.id})`,
        ),
      ),
    ].join("\n");
  }
  const parts = [
    ...(p.reviews.length > 0
      ? [
          `Due Reviews, most valuable first:\n${list(p.reviews.map(kcLine))}${p.moreReviews > 0 ? `\nAnd ${p.moreReviews} more.` : ""}`,
        ]
      : []),
    ...(p.topic ? [`Next Topic: ${topicBlock(p.topic)}`] : []),
  ];
  return parts.length > 0
    ? parts.join("\n")
    : "Nothing in the plan to propose.";
}

function topicBlock(topic: ProposedTopic): string {
  return [
    `${topic.name} (Topic id ${topic.id}): ${topic.centralQuestion}`,
    list([
      `KCs: ${topic.kcs.map(kcLine).join("; ")}`,
      ...(topic.anchors.length > 0
        ? [`Anchors: ${topic.anchors.map(kcLine).join("; ")}`]
        : []),
      ...topic.assumes.map(
        (a) =>
          `${a.kc} assumes, beyond the Materials: ${a.name}: ${a.description}`,
      ),
      ...(topic.readings.length > 0
        ? [
            `Reading sections: ${topic.readings
              .map((r) => `${r.label} (section id ${r.id})`)
              .join("; ")}`,
          ]
        : []),
      `Unseen Problems: ${topic.unseenProblems}`,
    ]),
  ].join("\n");
}

function notes({ notes: n }: TutorContext): string[] {
  return [
    ...(n.lastSession
      ? [
          `## Last session\n${n.lastSession.date}: ${n.lastSession.topics.join(", ") || "no Topic"}; ${n.lastSession.kcs} KCs checked, ${n.lastSession.belowFull} below full.`,
        ]
      : []),
    ...n.topics.map(({ topic, text }) => `## Topic notes: ${topic}\n${text}`),
    ...(n.memory === "" ? [] : [`## Memory\n${n.memory}`]),
    ...(n.briefNotes
      ? [
          `## The Brief's notes (the Student's words, paraphrased: hints, not facts)\n${n.briefNotes}`,
        ]
      : []),
    ...(n.materialNotes.length > 0
      ? [
          `## Notation of the Materials\n${n.materialNotes
            .map(({ material, text }) => `${material}:\n${text}`)
            .join("\n\n")}`,
        ]
      : []),
  ];
}

function mock({ mock: tasks }: TutorContext): string[] {
  if (tasks === null) return [];
  return [
    `## The Mock exam this session goes through, most points lost first\n${tasks
      .map((task, index) =>
        [
          `${index + 1}. ${task.awarded === null ? "not graded" : `${task.awarded} of ${task.points} points`}${task.problemId === null ? "" : ` (problem id ${task.problemId})`}`,
          quote(task.prompt),
          task.answer === null
            ? "Answer: none"
            : `Answer:\n${quote(task.answer)}`,
          ...task.reasons.map((reason) => `- ${reason}`),
        ].join("\n"),
      )
      .join("\n\n")}`,
  ];
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
