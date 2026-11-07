import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MockExamButton } from "@/features/study/components/mock-exam-button";
import { TODAY_MESSAGES } from "@/features/study/domain/today-messages";
import type { NextItem, StudyState } from "@/features/study/types";

/** Items the card lists in the final stretch. */
const FINAL_STRETCH_ITEMS = 5;

const KIND_NAMES: Record<NextItem["kind"], string> = {
  review: "Review",
  topic: "Topic",
  refresh: "Refresh",
};

/** Whole minutes, at least 1, such as "about 6 min". */
const aboutMinutes = (minutes: number) =>
  `about ${Math.max(1, Math.round(minutes))} min`;

/**
 * The Today card: the head of the ranking. Normally the due Reviews with
 * their minutes, then the next Topic (or refresh) with its minutes; in the
 * final stretch the first 5 items. Its buttons open a new Chat
 * (`chatHref`) that sends a first message as the Student: "Let's start."
 * while anything is ranked, "Let's review." with Reviews due and "Exam
 * problems please." once a KC is taught. Without a map or Topics it links
 * to the Course map to build or update it. The page passes the links, since
 * the map and the Chat belong to other features. With `mock`, Mock exam
 * shows once a KC is taught, and Continue mock exam while a mock is open.
 */
export function TodayCard({
  state,
  mapHref,
  topicHref,
  chatHref,
  mock,
}: {
  state: Pick<
    StudyState,
    "hasMap" | "hasTopics" | "ranking" | "finalStretch" | "taught"
  >;
  mapHref: string;
  /** A Topic's page. */
  topicHref: (topicId: string) => string;
  /** A new Chat. */
  chatHref: string;
  /** The Course, and its open mock's page or null. */
  mock?: { courseId: string; openHref: string | null };
}) {
  const { ranking } = state;
  const mapLink = (text: string) => (
    <Link href={mapHref} className="underline underline-offset-4">
      {text}
    </Link>
  );
  const reviews = state.finalStretch
    ? []
    : ranking.filter((item) => item.kind === "review");
  const next = state.finalStretch
    ? null
    : (ranking.find((item) => item.kind !== "review") ?? null);
  const name = (item: NextItem) =>
    item.kind === "topic" ? (
      <Link
        href={topicHref(item.id)}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Markdown>{item.name}</Markdown>
      </Link>
    ) : (
      <span className="font-medium">
        <Markdown>{item.name}</Markdown>
      </span>
    );

  let body;
  if (!state.hasMap) {
    body = (
      <p>{mapLink("Build your Course map")} to see what to study today.</p>
    );
  } else if (!state.hasTopics) {
    body = <p>{mapLink("Update your Course map")} to finish its Topics.</p>;
  } else if (ranking.length === 0) {
    body = <p>Nothing left to study right now.</p>;
  } else if (state.finalStretch) {
    body = (
      <ol aria-label="Next" className="flex flex-col gap-1">
        {ranking.slice(0, FINAL_STRETCH_ITEMS).map((item) => (
          <li key={`${item.kind}-${item.id}`} className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {KIND_NAMES[item.kind]} · {aboutMinutes(item.minutes)}
            </span>
            {name(item)}
          </li>
        ))}
      </ol>
    );
  } else {
    const reviewMinutes = reviews.reduce((sum, item) => sum + item.minutes, 0);
    body = (
      <>
        {reviews.length > 0 && (
          <p>
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"} due,{" "}
            {aboutMinutes(reviewMinutes)}
          </p>
        )}
        {next && (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">
              {next.kind === "topic" ? "Next Topic" : "Refresh"} ·{" "}
              {aboutMinutes(next.minutes)}
            </p>
            {name(next)}
            {next.centralQuestion !== null && (
              <div className="text-muted-foreground">
                <Markdown>{next.centralQuestion}</Markdown>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  const ready = state.hasMap && state.hasTopics;
  const say = (text: string) => `${chatHref}?say=${encodeURIComponent(text)}`;
  const buttons = [
    ...(ranking.length > 0 ? [TODAY_MESSAGES.start] : []),
    ...(ranking.some((item) => item.kind === "review")
      ? [TODAY_MESSAGES.review]
      : []),
    ...(state.taught ? [TODAY_MESSAGES.exam] : []),
  ];
  const showMock = mock && (mock.openHref !== null || state.taught);
  return (
    <Card
      role="region"
      aria-label="Today"
      className="w-full max-w-md gap-3 py-4 text-left"
    >
      <CardHeader className="px-4">
        <CardTitle>Today</CardTitle>
        <CardDescription className="sr-only">
          What to study next
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 text-sm">
        {body}
        {ready && (buttons.length > 0 || showMock) && (
          <div className="flex flex-wrap gap-2">
            {buttons.map((text, index) => (
              <Button
                key={text}
                asChild
                size="sm"
                variant={index === 0 ? "default" : "outline"}
              >
                <Link href={say(text)}>{text}</Link>
              </Button>
            ))}
            {showMock && (
              <MockExamButton
                courseId={mock.courseId}
                openHref={mock.openHref}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
