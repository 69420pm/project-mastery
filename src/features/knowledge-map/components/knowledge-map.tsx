"use client";

import { RotateCwIcon, WaypointsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BloomLevel, KcType } from "@/features/knowledge-map/schemas";
import { startKnowledgeMapBuild } from "@/features/knowledge-map/server/actions";
import type {
  BigIdeaView,
  KcView,
  KnowledgeMapView,
  MapBuild,
} from "@/features/knowledge-map/types";

const TYPE_NAMES: Record<KcType, string> = {
  fact: "Fact",
  concept: "Concept",
  procedure: "Procedure",
  decision: "Decision",
  prior: "Prior knowledge",
};

const BLOOM_NAMES: Record<BloomLevel, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** How often the page refreshes while a build runs. */
const BUILD_POLL_MS = 2000;

/**
 * A Course's Knowledge map, read-only: the build's state with Build or
 * Rebuild, then each big idea with its KCs. The page refreshes itself while
 * a build runs.
 */
export function KnowledgeMap({ map }: { map: KnowledgeMapView }) {
  const building = map.build?.status === "building";
  useBuildPolling(building);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Knowledge map
          </h1>
          <BuildButton
            courseId={map.courseId}
            hasMap={map.build?.finishedAt != null}
            disabled={!map.canBuild}
          />
        </div>
        <BuildStatus build={map.build} />
      </div>

      {map.bigIdeas.length === 0 ? (
        <EmptyMap building={building} />
      ) : (
        <ol aria-label="Big ideas" className="flex flex-col gap-6">
          {map.bigIdeas.map((bigIdea) => (
            <BigIdea key={bigIdea.id} bigIdea={bigIdea} />
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyMap({ building }: { building: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <WaypointsIcon className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {building
          ? "The first map appears here when the build is done."
          : "Parse your materials, then build the map of what they teach."}
      </p>
    </div>
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
 * Starts a build: Build before the first map, Rebuild after. Disabled
 * while one runs or before a Material is parsed.
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
        {hasMap ? "Rebuild" : "Build knowledge map"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Refreshes the page's data while a build runs. */
function useBuildPolling(building: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => router.refresh(), BUILD_POLL_MS);
    return () => clearInterval(timer);
  }, [building, router]);
}

function BigIdea({ bigIdea }: { bigIdea: BigIdeaView }) {
  return (
    <li className="flex flex-col gap-3">
      <section aria-label={bigIdea.name} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {/* Not an h2: the markdown renders a paragraph, which h2 may not hold. */}
          <div role="heading" aria-level={2} className="text-lg font-semibold">
            <Markdown>{bigIdea.name}</Markdown>
          </div>
          <div className="text-sm text-muted-foreground">
            <Markdown>{bigIdea.description}</Markdown>
          </div>
        </div>
        <ul aria-label="Knowledge components" className="flex flex-col gap-2">
          {bigIdea.kcs.map((kc) => (
            <Kc key={kc.id} kc={kc} />
          ))}
        </ul>
      </section>
    </li>
  );
}

function Kc({ kc }: { kc: KcView }) {
  return (
    <li>
      <article
        aria-label={kc.name}
        className="flex flex-col gap-1.5 rounded-xl border px-4 py-3"
      >
        <div className="font-medium">
          <Markdown>{kc.name}</Markdown>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{TYPE_NAMES[kc.type]}</Badge>
          {kc.bloom && <Badge variant="outline">{BLOOM_NAMES[kc.bloom]}</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">
          <Markdown>{kc.description}</Markdown>
        </div>
        {kc.sources.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Sources: {kc.sources.join(", ")}
          </p>
        )}
      </article>
    </li>
  );
}
