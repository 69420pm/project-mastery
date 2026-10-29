"use client";

import { RotateCwIcon, WaypointsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { startKnowledgeMapBuild } from "@/features/knowledge-map/server/actions";
import type {
  KnowledgeMapView,
  MapBuild,
  MapKcLearning,
  MapPriorities,
  MapTopic,
  MapTopicBadges,
  MapTopicReadiness,
  MapTopicStates,
} from "@/features/knowledge-map/types";
import { CourseMapGraph } from "./course-map-graph";
import { PriorityStatus } from "./kc-priority";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** How often the page refreshes while a build runs. */
const BUILD_POLL_MS = 2000;

/**
 * A Course's home, the Course map: the build's state with Build or Update
 * map, the Priorities' state, the reviews due and the study plan's line
 * (`planLine`, a slot, since the study feature that owns the plan depends on
 * this one), the Today card (`today`, a slot too), then its Topics on its Big ideas as a graph filling the rest of
 * the page, each with its Topic state and recall today from `topicStates`
 * and its plan badges from `topicBadges`, which the page passes in since
 * the study feature computes them. The page
 * refreshes itself while a build or a priority run runs.
 */
export function CourseMap({
  map,
  topics,
  priorities,
  learning,
  topicStates,
  topicReadiness = {},
  topicBadges,
  planLine,
  readinessLine,
  today,
}: {
  map: KnowledgeMapView;
  /** In Course order; empty before a build stored Topics. */
  topics: MapTopic[];
  priorities: MapPriorities;
  learning: MapKcLearning;
  topicStates: MapTopicStates;
  topicReadiness?: MapTopicReadiness;
  topicBadges: MapTopicBadges;
  planLine: ReactNode;
  /** The study feature's Readiness line, shown in the header. */
  readinessLine?: ReactNode;
  /** The study feature's Today card, shown above the graph. */
  today?: ReactNode;
}) {
  const kcs = map.bigIdeas.flatMap((b) => b.kcs);
  const dueCount = kcs.filter((kc) => learning[kc.id]?.state === "due").length;
  const building = map.build?.status === "building";
  useBuildPolling(building || priorities.running);
  const buildButton = (
    <BuildButton
      courseId={map.courseId}
      hasMap={map.build?.finishedAt != null}
      disabled={!map.canBuild}
    />
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 px-4 pt-8 pb-4 sm:px-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Course map"
          description="What your materials teach, and where you stand on each part."
          actions={buildButton}
        />
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <BuildStatus build={map.build} />
          <PriorityStatus priorities={priorities} />
          {map.bigIdeas.length > 0 && (
            <>
              <p>
                {dueCount} {dueCount === 1 ? "review" : "reviews"} due
              </p>
              {planLine}
              {readinessLine}
            </>
          )}
        </div>
      </div>

      {map.bigIdeas.length === 0 || (topics.length === 0 && building) ? (
        <div className="max-w-3xl">
          <EmptyMap building={building} />
        </div>
      ) : topics.length === 0 ? (
        <div className="max-w-3xl">
          <EmptyState
            icon={<WaypointsIcon />}
            title="Update map to group your KCs into Topics"
            description="This map was built before Topics, or its Topics failed."
            action={buildButton}
          />
        </div>
      ) : (
        <>
          {today}
          <div className="min-h-96 flex-1">
            <CourseMapGraph
              map={map}
              topics={topics}
              topicStates={topicStates}
              topicReadiness={topicReadiness}
              topicBadges={topicBadges}
            />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyMap({ building }: { building: boolean }) {
  return (
    <EmptyState
      icon={<WaypointsIcon />}
      title={building ? "Building your map" : "No map yet"}
      description={
        building
          ? "The first map appears here when the build is done."
          : "Parse your materials, then build the map of what they teach."
      }
    />
  );
}

function FormattedTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateFormat.format(new Date(iso))}
    </time>
  );
}

/** The last build's state: running, failed with its reason, or done. */
function BuildStatus({ build }: { build: MapBuild }) {
  const lastBuilt = build?.finishedAt && (
    <>
      Last built <FormattedTime iso={build.finishedAt} />
    </>
  );
  return (
    <div
      role="status"
      aria-label="Build status"
      className="flex flex-col gap-1 text-sm text-muted-foreground"
    >
      {build === null && <p>Not built yet.</p>}
      {build?.status === "building" && (
        <p className="flex items-center gap-2">
          <Spinner className="size-3" />
          Building…
        </p>
      )}
      {build?.status === "failed" && (
        <p className="text-destructive">Build failed: {build.failureReason}</p>
      )}
      {lastBuilt && <p>{lastBuilt}</p>}
    </div>
  );
}

/**
 * Starts a build: Build before the first map, Update map after, which maps
 * what Materials added or deleted since. Disabled while one runs or before a
 * Material is parsed.
 */
function BuildButton({
  courseId,
  hasMap,
  disabled,
}: {
  courseId: string;
  hasMap: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startKnowledgeMapBuild({ courseId });
            if (!result.ok) setError(result.message);
            router.refresh();
          })
        }
      >
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RotateCwIcon data-icon="inline-start" />
        )}
        {hasMap ? "Update map" : "Build knowledge map"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Refreshes the page's data while a build or a priority run runs. */
function useBuildPolling(building: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => router.refresh(), BUILD_POLL_MS);
    return () => clearInterval(timer);
  }, [building, router]);
}
