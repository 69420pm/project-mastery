"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AnswerField } from "@/components/answer-field";
import { Markdown } from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  countdownText,
  useCountdown,
} from "@/features/study/hooks/use-countdown";
import { MAX_MOCK_ANSWER_LENGTH } from "@/features/study/schemas";
import {
  saveMockTaskAnswer,
  submitMockExam,
} from "@/features/study/server/actions";
import type { MockExamView } from "@/features/study/types";

type Answer = { text: string; confidence: number | undefined };

const same = (a: Answer | undefined, b: Answer) =>
  a?.text === b.text && a.confidence === b.confidence;

/**
 * A Mock exam in progress (#185), full screen, with no tutor and no
 * Materials: one task at a time with its answer box and confidence row,
 * navigation between the tasks, and a countdown from the server's
 * deadline. Each answer saves when the Student leaves its box or taps a
 * confidence; Submit asks first, and the sheet submits itself at 0.
 */
export function MockTaskSheet({
  mock,
}: {
  mock: MockExamView & { deadline: string };
}) {
  const router = useRouter();
  const { tasks } = mock;
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      tasks.map((task) => [
        task.questionId,
        { text: task.answer ?? "", confidence: task.confidence ?? undefined },
      ]),
    ),
  );
  // What the database holds of each answer, so leaving an unchanged box
  // saves nothing.
  const stored = useRef<Record<string, Answer>>({ ...answers });
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Each task's saves run one after another, so the last one lands last and
  // submit can wait for one still in flight.
  const saving = useRef<Record<string, Promise<void>>>({});

  function save(questionId: string, answer: Answer): Promise<void> {
    const next = (saving.current[questionId] ?? Promise.resolve())
      .catch(() => {})
      .then(() => persist(questionId, answer));
    saving.current[questionId] = next;
    return next;
  }

  async function persist(questionId: string, answer: Answer) {
    if (
      same(stored.current[questionId], answer) ||
      answer.text.length > MAX_MOCK_ANSWER_LENGTH
    ) {
      return;
    }
    const before = stored.current[questionId];
    stored.current[questionId] = answer;
    const result = await saveMockTaskAnswer({
      questionId,
      answer: answer.text,
      confidence: answer.confidence ?? null,
    });
    if (!result.ok && before) stored.current[questionId] = before;
    setNotices((notices) => ({
      ...notices,
      [questionId]: result.ok ? "Saved" : result.message,
    }));
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setConfirming(false);
    await Promise.all(
      tasks.map((task) => save(task.questionId, answers[task.questionId]!)),
    );
    await submitMockExam({ mockId: mock.id });
    router.refresh();
  }

  const remaining = useCountdown(mock.deadline, mock.serverNow, () => {
    void submit();
  });

  const task = tasks[current]!;
  const answer = answers[task.questionId]!;
  const tooLong = answer.text.length > MAX_MOCK_ANSWER_LENGTH;
  const change = (next: Answer) =>
    setAnswers((answers) => ({ ...answers, [task.questionId]: next }));

  return (
    <div
      role="region"
      aria-label="Mock exam"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="font-semibold">Mock exam</h1>
        <span
          role="timer"
          aria-label="Time left"
          className="ml-auto font-mono text-sm tabular-nums"
        >
          {countdownText(remaining)}
        </span>
        <Button
          size="sm"
          disabled={submitting}
          onClick={() => setConfirming(true)}
        >
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </header>
      <nav
        aria-label="Tasks"
        className="flex flex-wrap gap-1 border-b px-4 py-2"
      >
        {tasks.map((item, index) => {
          const answered = answers[item.questionId]!.text.trim() !== "";
          return (
            <Button
              key={item.questionId}
              size="icon-sm"
              variant={
                index === current
                  ? "default"
                  : answered
                    ? "secondary"
                    : "outline"
              }
              aria-current={index === current ? "step" : undefined}
              aria-label={`Task ${index + 1}${answered ? ", answered" : ""}`}
              onClick={() => setCurrent(index)}
            >
              {index + 1}
            </Button>
          );
        })}
      </nav>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <section
            aria-label={`Task ${current + 1}`}
            data-testid="task-card"
            className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm"
          >
            <p className="text-muted-foreground">
              Task {current + 1} of {tasks.length} · {task.points}{" "}
              {task.points === 1 ? "point" : "points"}
            </p>
            <Markdown>{task.prompt}</Markdown>
            <AnswerField
              key={task.questionId}
              text={answer.text}
              onTextChange={(text) => change({ ...answer, text })}
              onBlur={() => void save(task.questionId, answer)}
              confidence={answer.confidence}
              onConfidenceChange={(confidence) => {
                const next = { ...answer, confidence };
                change(next);
                void save(task.questionId, next);
              }}
              invalid={tooLong}
              disabled={submitting}
            >
              {tooLong ? (
                <p role="alert" className="text-destructive">
                  Keep your answer under{" "}
                  {MAX_MOCK_ANSWER_LENGTH.toLocaleString("en-US")} characters.
                </p>
              ) : (
                <span role="status" className="text-muted-foreground">
                  {notices[task.questionId]}
                </span>
              )}
            </AnswerField>
          </section>
          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => setCurrent(current - 1)}
            >
              <ChevronLeftIcon />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current === tasks.length - 1}
              onClick={() => setCurrent(current + 1)}
            >
              Next
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit the mock exam?</AlertDialogTitle>
            <AlertDialogDescription>
              You can&apos;t change your answers after submitting.
              {countUnanswered(tasks, answers) > 0 &&
                ` ${countUnanswered(tasks, answers)} of ${tasks.length} tasks have no answer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()}>
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function countUnanswered(
  tasks: MockExamView["tasks"],
  answers: Record<string, Answer>,
): number {
  return tasks.filter((task) => answers[task.questionId]!.text.trim() === "")
    .length;
}
