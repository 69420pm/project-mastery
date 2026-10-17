"use client";

import { LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEMANTIC_LINK_NAMES } from "@/features/knowledge-map/domain/kc-labels";
import type { MapLayers } from "@/features/knowledge-map/domain/map-graph";
import { SEMANTIC_LINK_TYPES } from "@/features/knowledge-map/schemas";
import { SEMANTIC_LINK_COLORS } from "./map-graph";

type Flag = Exclude<keyof MapLayers, "semanticLinks">;

const FLAGS: Array<[Flag, string]> = [
  ["bigIdeaGroups", "Big-idea groups"],
  ["priorKnowledge", "Prior knowledge"],
  ["exercises", "Exercises"],
  ["solutionBadges", "Solution badges"],
  ["prerequisites", "Prerequisites"],
];

/**
 * The graph's layer toggles in a menu that stays open while they change:
 * the node and edge layers, then one toggle per Semantic link type.
 */
export function LayerToggles({
  layers,
  onChange,
}: {
  layers: MapLayers;
  onChange: (layers: MapLayers) => void;
}) {
  // Keeps the menu open on a toggle.
  const keepOpen = (event: Event) => event.preventDefault();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <LayersIcon data-icon="inline-start" />
          Layers
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        {FLAGS.map(([flag, name]) => (
          <DropdownMenuCheckboxItem
            key={flag}
            checked={layers[flag]}
            disabled={flag === "solutionBadges" && !layers.exercises}
            onSelect={keepOpen}
            onCheckedChange={(checked) =>
              onChange({ ...layers, [flag]: checked })
            }
          >
            {name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Semantic links</DropdownMenuLabel>
        {SEMANTIC_LINK_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={layers.semanticLinks[type]}
            onSelect={keepOpen}
            onCheckedChange={(checked) =>
              onChange({
                ...layers,
                semanticLinks: { ...layers.semanticLinks, [type]: checked },
              })
            }
          >
            <span
              aria-hidden
              className="h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: SEMANTIC_LINK_COLORS[type] }}
            />
            {SEMANTIC_LINK_NAMES[type]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
