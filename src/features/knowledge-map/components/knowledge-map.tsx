"use client";

import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FocusDepth } from "@/features/knowledge-map/domain/focus";
import { legendEntries } from "@/features/knowledge-map/domain/encodings";
import {
  STATE_NAMES,
  TYPE_NAMES,
} from "@/features/knowledge-map/domain/kc-labels";
import { useSavedSettings } from "@/features/knowledge-map/hooks/use-saved-settings";
import type {
  KnowledgeMapView,
  MapKcLearning,
  MapPriorities,
} from "@/features/knowledge-map/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { BigIdeaPanel } from "./big-idea-panel";
import { EncodingControls, Legend } from "./encoding-controls";
import { ExercisePanel } from "./exercise-panel";
import { FocusDepthMenu } from "./focus-depth";
import { KcPanel } from "./kc-panel";
import { LayerToggles } from "./layer-toggles";
import { MapGraph } from "./map-graph";

/**
 * A Knowledge map's KC graph, read-only, with its legend, focus, encoding
 * and layer controls, filling the space it gets. Clicking a KC opens every
 * stat about it beside the graph, or in a Sheet below `md`: its learning
 * from `learning`, its Priority from `priorities` and, for a KC in
 * `leftOut`, the `leftOutBadge`. The selected node is focused on the graph,
 * as far as the focus depth reaches; Esc or a click on the empty canvas
 * clears it. A selection stays while its node exists.
 */
export function KnowledgeMap({
  map,
  priorities,
  learning,
}: {
  map: KnowledgeMapView;
  priorities: MapPriorities;
  learning: MapKcLearning;
}) {
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
    onSelect: setSelectedId,
  });
  const panel = selected?.panel ?? null;
  const panelLabel = selected?.label ?? "KC details";

  return (
    <>
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
                onChange={(next) => saveSettings({ ...settings, layers: next })}
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
    </>
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
  onSelect,
}: {
  id: string | null;
  map: KnowledgeMapView;
  learning: MapKcLearning;
  priorities: MapPriorities;
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
