"use client";

import { RotateCwIcon, WaypointsIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { FocusDepth } from "@/features/knowledge-map/domain/focus";
import { legendEntries } from "@/features/knowledge-map/domain/encodings";
import {
  STATE_NAMES,
  TYPE_NAMES,
} from "@/features/knowledge-map/domain/kc-labels";
import { useSavedSettings } from "@/features/knowledge-map/hooks/use-saved-settings";
import { startKnowledgeMapBuild } from "@/features/knowledge-map/server/actions";
import type {
  KnowledgeMapView,
  MapBuild,
  MapKcLearning,
  MapPlan,
  MapPriorities,
} from "@/features/knowledge-map/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { BigIdeaPanel } from "./big-idea-panel";
import { EncodingControls, Legend } from "./encoding-controls";
import { ExercisePanel } from "./exercise-panel";
import { FocusDepthMenu } from "./focus-depth";
import { KcPanel } from "./kc-panel";
import { LayerToggles } from "./layer-toggles";
import { PriorityStatus } from "./kc-priority";
import { MapGraph } from "./map-graph";
import { PlanLine } from "./study-plan";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** How often the page refreshes while a build runs. */
const BUILD_POLL_MS = 2000;

/**
 * A Course's Knowledge map, read-only: the build's state with Build or
 * Update map, the reviews due, the study plan from `plan` (linking to the
 * Course's Brief, `briefHref`), then the map as a graph filling the rest of
 * the page. Clicking a KC opens every stat about it beside the graph, or in a
 * Sheet below `md`: its learning from `learning` and its Priority from
 * `priorities`. The selected node is focused on the graph, as far as the
 * focus depth reaches; Esc or a click on the empty canvas clears it. The page
 * refreshes itself while a
 * build or a priority run runs, and a selection stays while its node exists.
 */
export function KnowledgeMap({
  map,
  briefHref,
  priorities,
  learning,
  plan,
}: {
  map: KnowledgeMapView;
  briefHref: string;
  priorities: MapPriorities;
  learning: MapKcLearning;
  plan: MapPlan;
}) {
  const kcs = [...map.bigIdeas.flatMap((b) => b.kcs), ...map.priorKnowledge];
  const dueCount = kcs.filter((kc) => learning[kc.id]?.state === "due").length;
  const building = map.build?.status === "building";
  useBuildPolling(building || priorities.running);
  const isWide = !useIsMobile();
  const [settings, saveSettings] = useSavedSettings();
  const { layers, colorBy, sizeByPriority } = settings;
  const [depth, setDepth] = useState<FocusDepth>("neighbours");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const clear = () => setSelectedId(null);
  useEscapeToClear(selectedId !== null, clear);
  const selected = selectedPanel({
    id: selectedId,
    map,
    learning,
    priorities,
    plan,
    onSelect: setSelectedId,
  });
  const panel = selected?.panel ?? null;
  const panelLabel = selected?.label ?? "KC details";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 px-4 pt-2 pb-4 sm:px-6">
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
        <PriorityStatus priorities={priorities} />
        {map.bigIdeas.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {dueCount} {dueCount === 1 ? "review" : "reviews"} due
            </p>
            <PlanLine plan={plan} briefHref={briefHref} />
          </div>
        )}
      </div>

      {map.bigIdeas.length === 0 ? (
        <div className="max-w-3xl">
          <EmptyMap building={building} />
        </div>
      ) : (
        <div className="flex min-h-96 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Legend
                entries={legendEntries(
                  colorBy,
                  map.bigIdeas,
                  TYPE_NAMES,
                  STATE_NAMES,
                )}
              />
              <div className="flex shrink-0 flex-wrap gap-2">
                <FocusDepthMenu depth={depth} onChange={setDepth} />
                <EncodingControls
                  colorBy={colorBy}
                  sizeByPriority={sizeByPriority}
                  onColorBy={(next) =>
                    saveSettings({ ...settings, colorBy: next })
                  }
                  onSizeByPriority={(on) =>
                    saveSettings({ ...settings, sizeByPriority: on })
                  }
                />
                <LayerToggles
                  layers={layers}
                  onChange={(next) =>
                    saveSettings({ ...settings, layers: next })
                  }
                />
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <MapGraph
                map={map}
                learning={learning}
                priorities={priorities}
                layers={layers}
                colorBy={colorBy}
                sizeByPriority={sizeByPriority}
                selectedId={selected ? selectedId : null}
                depth={depth}
                onSelect={setSelectedId}
                onClear={clear}
              />
            </div>
          </div>
          {isWide && panel && (
            <aside
              aria-label={panelLabel}
              className="w-96 shrink-0 overflow-y-auto rounded-xl border"
            >
              <div className="flex justify-end px-2 pt-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  onClick={() => setSelectedId(null)}
                >
                  <XIcon />
                </Button>
              </div>
              {panel}
            </aside>
          )}
        </div>
      )}
      <Sheet
        open={!isWide && panel !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="bottom"
          aria-label={panelLabel}
          className="max-h-[80vh] overflow-y-auto"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>{panelLabel}</SheetTitle>
            <SheetDescription className="sr-only">
              Everything about the selected node.
            </SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The selected KC's, Exercise's or Big idea's panel with its label; null
 * when nothing, or a node the map no longer has, is selected.
 */
function selectedPanel({
  id,
  map,
  learning,
  priorities,
  plan,
  onSelect,
}: {
  id: string | null;
  map: KnowledgeMapView;
  learning: MapKcLearning;
  priorities: MapPriorities;
  plan: MapPlan;
  onSelect: (id: string) => void;
}): { label: string; panel: ReactNode } | null {
  if (id === null) return null;
  const kcs = [...map.bigIdeas.flatMap((b) => b.kcs), ...map.priorKnowledge];
  const kc = kcs.find((k) => k.id === id);
  if (kc) {
    return {
      label: "KC details",
      panel: (
        <KcPanel
          kc={kc}
          map={map}
          learning={learning}
          priorities={priorities}
          leftOut={plan.leftOut.includes(kc.id)}
          onSelect={onSelect}
        />
      ),
    };
  }
  const exercise = map.exercises.find((e) => e.id === id);
  if (exercise) {
    return {
      label: "Exercise details",
      panel: (
        <ExercisePanel
          exercise={exercise}
          kcs={new Map(kcs.map((k) => [k.id, k]))}
          learning={learning}
          onSelect={onSelect}
        />
      ),
    };
  }
  const bigIdea = map.bigIdeas.find((b) => b.id === id);
  if (bigIdea) {
    return {
      label: "Big idea details",
      panel: <BigIdeaPanel bigIdea={bigIdea} learning={learning} />,
    };
  }
  return null;
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

/**
 * Calls `clear` on Esc while `active`, unless a menu is open: Esc closes
 * that first.
 */
function useEscapeToClear(active: boolean, clear: () => void) {
  const latest = useRef(clear);
  useEffect(() => {
    latest.current = clear;
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[role=menu]")
      ) {
        return;
      }
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);
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
