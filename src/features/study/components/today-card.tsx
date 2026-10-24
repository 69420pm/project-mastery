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
import type { StudyPlan } from "@/features/study/types";

/**
 * The Today card (#177): the due reviews, the next Topic with its central
 * question and a link to its page, the Phase's hint and Start, which opens
 * a new Chat. Without a map or Topics it says to build or update the map.
 * The page passes the links, since the map and the Chat belong to other
 * features; without `startHref`, as in a new Chat, there is no Start.
 */
export function TodayCard({
  plan,
  mapHref,
  topicHref,
  startHref,
}: {
  plan: Pick<StudyPlan, "hasMap" | "topics" | "today">;
  mapHref: string;
  /** The next Topic's page; null without one. */
  topicHref: string | null;
  startHref?: string;
}) {
  const { reviews, next, hint } = plan.today;
  const mapLink = (text: string) => (
    <Link href={mapHref} className="underline underline-offset-4">
      {text}
    </Link>
  );
  let body;
  if (!plan.hasMap) {
    body = (
      <p>{mapLink("Build your Course map")} to see what to study today.</p>
    );
  } else if (plan.topics.length === 0) {
    body = (
      <p>{mapLink("Update your Course map")} to group your KCs into Topics.</p>
    );
  } else {
    body = (
      <>
        {reviews && (
          <p>
            {reviews.count} {reviews.count === 1 ? "review" : "reviews"} due,
            about {reviews.minutes} min
          </p>
        )}
        {next ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Next Topic</p>
            {topicHref ? (
              <Link
                href={topicHref}
                className="font-medium underline-offset-4 hover:underline"
              >
                <Markdown>{next.name}</Markdown>
              </Link>
            ) : (
              <Markdown>{next.name}</Markdown>
            )}
            <div className="text-muted-foreground">
              <Markdown>{next.centralQuestion}</Markdown>
            </div>
          </div>
        ) : (
          !reviews && <p>Nothing planned for today.</p>
        )}
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </>
    );
  }
  const ready = plan.hasMap && plan.topics.length > 0;
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
        {ready && startHref && (
          <Button asChild size="sm" className="self-start">
            <Link href={startHref}>Start</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
