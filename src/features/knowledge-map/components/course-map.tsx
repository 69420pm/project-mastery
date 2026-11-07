"use client";

import { RotateCwIcon, WaypointsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
  useTransition,
} from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { checkReportLine } from "@/features/knowledge-map/domain/check-report";
import { startKnowledgeMapBuild } from "@/features/knowledge-map/server/actions";
import type {
  KnowledgeMapView,
  MapBuild,
  MapTopic,
  MapTopicBadges,
  MapTopicStudies,
} from "@/features/knowledge-map/types";
import { CourseMapGraph } from "./course-map-graph";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** How often the page refreshes while a build runs. */
const BUILD_POLL_MS = 2000;

/**
 * A Course's home, the Course map: the build's state with Build or Update
 * map, the Progress and Readiness lines (`progressLine` and
 * `readinessLine`, slots, since the study feature that owns them depends
 * on this one), the Today card (`today`, a slot too), then its Topic tree
 * as a graph of nested boxes filling the rest of the page, each with how
 * many of its KCs are learned and its Readiness from `topicStudies` and its
 * plan badges from `topicBadges`, which the page passes in since the study
 * feature computes them. The page refreshes itself while a build runs.
 */
export function CourseMap({
  map,
  topics,
  topicStudies,
  topicBadges,
  progressLine,
  readinessLine,
  today,
  checkDetails = false,
}: {
  map: KnowledgeMapView;
  /** The Topic tree in tree order; empty before a build stored Topics. */
  topics: MapTopic[];
  topicStudies: MapTopicStudies;
  topicBadges: MapTopicBadges;
  /** The study feature's Progress line, shown in the header. */
  progressLine: ReactNode;
  /** The study feature's Readiness line, shown in the header. */
  readinessLine?: ReactNode;
  /** The study feature's Today card, shown above the graph. */
  today?: ReactNode;
  /** Whether to show the check report's full lists: outside production. */
  checkDetails?: boolean;
}) {
  const { kcs } = map;
  const building = map.build?.status === "building";
  useBuildPolling(building);
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
          {kcs.length > 0 && (
            <>
              {progressLine}
              {readinessLine}
            </>
          )}
        </div>
        {!building && (
          <MapCheck
            report={map.checkReport}
            details={checkDetails}
            updateButton={
              <BuildButton
                courseId={map.courseId}
                hasMap
                disabled={!map.canBuild}
                size="sm"
                variant="outline"
              />
            }
          />
        )}
      </div>

      {kcs.length === 0 || (topics.length === 0 && building) ? (
        <div className="max-w-3xl">
          <EmptyMap building={building} />
        </div>
      ) : topics.length === 0 ? (
        <div className="max-w-3xl">
          <EmptyState
            icon={<WaypointsIcon />}
            title="Update map to finish your Topics"
            description="The last update stopped before it grouped your KCs into Topics."
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
              topicStudies={topicStudies}
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
 * What the last build's check report says of a weak map: one line when it
 * left pages unread or Chapters covered only in part, with Update map, and
 * with `details` (outside production) its full lists.
 */
function MapCheck({
  report,
  details,
  updateButton,
}: {
  report: KnowledgeMapView["checkReport"];
  details: boolean;
  updateButton: ReactNode;
}) {
  if (!report) return null;
  const line = checkReportLine(report);
  const lists = [
    { title: "Chapters without KCs", items: report.chaptersWithoutKcs },
    { title: "Exercises without KCs", items: report.exercisesWithoutKcs },
    {
      title: "Units below the coverage bar",
      items: report.unitsBelowCoverage.map(
        (unit) => `${unit.chapter}: ${Math.round(unit.coverage * 100)}%`,
      ),
    },
  ].filter((list) => list.items.length > 0);
  if (!line && !(details && lists.length > 0)) return null;
  return (
    <div
      role="note"
      aria-label="Map check"
      className="flex flex-col gap-2 text-sm text-muted-foreground"
    >
      {line && (
        <div className="flex flex-wrap items-center gap-3">
          <p>{line}.</p>
          {updateButton}
        </div>
      )}
      {details && lists.length > 0 && (
        <details>
          <summary className="cursor-pointer">Check report</summary>
          <div className="mt-2 flex flex-col gap-2">
            {lists.map((list) => (
              <div key={list.title}>
                <p className="font-medium text-foreground">{list.title}</p>
                <ul className="list-inside list-disc">
                  {list.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
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
  size,
  variant,
}: {
  courseId: string;
  hasMap: boolean;
  disabled: boolean;
  size?: ComponentProps<typeof Button>["size"];
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size={size}
        variant={variant}
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
