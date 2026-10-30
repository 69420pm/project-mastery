"use client";

import { LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MapLayers } from "@/features/knowledge-map/domain/map-graph";

const FLAGS: Array<[keyof MapLayers, string]> = [
  ["bigIdeaGroups", "Big-idea groups"],
  ["exercises", "Exercises"],
  ["prerequisites", "Prerequisites"],
];

/**
 * The graph's layer toggles in a menu that stays open while they change.
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
            onSelect={keepOpen}
            onCheckedChange={(checked) =>
              onChange({ ...layers, [flag]: checked })
            }
          >
            {name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
