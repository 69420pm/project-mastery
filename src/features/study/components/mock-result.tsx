import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { MockResult, MockTask } from "@/features/study/types";

const pointsText = (points: number) =>
  `${points} ${points === 1 ? "point" : "points"}`;

/** A task's answer, its points out of its points and its step reasons. */
function GradedTask({ task, number }: { task: MockTask; number: number }) {
  const { grade } = task;
  return (
    <li
      aria-label={`Task ${number}`}
      className="flex flex-col gap-2 rounded-md border p-3"
    >
      <p className="text-muted-foreground">
        Task {number} ·{" "}
        {grade?.status === "graded"
          ? `${grade.pointsAwarded} of ${pointsText(task.points)}`
          : pointsText(task.points)}
      </p>
      <Markdown>{task.prompt}</Markdown>
      <div className="border-t pt-2">
        {task.answer ? (
          <Markdown>{task.answer}</Markdown>
        ) : (
          <p className="text-muted-foreground">No answer</p>
        )}
      </div>
      {grade?.status === "failed" && (
        <p className="text-muted-foreground">This task could not be graded.</p>
      )}
      {grade?.status === "graded" && (
        <>
          {grade.check === "mismatch" && (
            <p>Your final value does not match the solution&apos;s.</p>
          )}
          {grade.steps.length > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-2">
              {grade.steps.map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {step.points}
                  </span>
                  <Markdown>{step.reason}</Markdown>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/**
 * A graded Mock exam (#186): the score against the prediction, the points
 * per Topic, the Student's calibration on sure answers, each task's points
 * and reasons, and Go through it with the tutor. The reference solutions
 * stay for the Results session.
 */
export function MockResultView({
  result,
  tasks,
  tutorHref,
}: {
  result: MockResult;
  tasks: MockTask[];
  /** A new Chat that goes through the mock. */
  tutorHref: string;
}) {
  return (
    <>
      <p className="text-base font-medium">
        We predicted {result.predictedPercent}%, you scored{" "}
        {result.scorePercent}%
      </p>
      {result.sure && (
        <p>
          Your sure answers (confidence 4) were right {result.sure.right} of{" "}
          {result.sure.total} {result.sure.total === 1 ? "time" : "times"}
        </p>
      )}
      <Button asChild className="self-start">
        <Link href={tutorHref}>Go through it with the tutor</Link>
      </Button>
      {result.topics.length > 0 && (
        <table className="w-full" aria-label="Points per Topic">
          <tbody>
            {result.topics.map((topic) => (
              <tr key={topic.name} className="border-b last:border-0">
                <th scope="row" className="py-1 text-left font-normal">
                  {topic.name}
                </th>
                <td className="py-1 text-right tabular-nums">
                  {topic.awarded} / {topic.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ol className="flex flex-col gap-3">
        {tasks.map((task, index) => (
          <GradedTask key={task.questionId} task={task} number={index + 1} />
        ))}
      </ol>
    </>
  );
}
