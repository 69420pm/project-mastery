"use client";

import { PaletteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COLOR_BY_NAMES,
  COLOR_BYS,
  type ColorBy,
  type LegendEntry,
} from "@/features/knowledge-map/domain/encodings";

/** The "Colour by" and "Size by Priority" choices, in a menu. */
export function EncodingControls({
  colorBy,
  sizeByPriority,
  onColorBy,
  onSizeByPriority,
}: {
  colorBy: ColorBy;
  sizeByPriority: boolean;
  onColorBy: (colorBy: ColorBy) => void;
  onSizeByPriority: (on: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <PaletteIcon data-icon="inline-start" />
          Colour: {COLOR_BY_NAMES[colorBy]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Colour KCs by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={colorBy}
          onValueChange={(value) => onColorBy(value as ColorBy)}
        >
          {COLOR_BYS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {COLOR_BY_NAMES[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={sizeByPriority}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={onSizeByPriority}
        >
          Size by Priority
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What each colour on the graph means. */
export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul
      aria-label="Legend"
      className="flex min-w-0 gap-4 overflow-x-auto pb-1 text-xs whitespace-nowrap text-muted-foreground"
    >
      {entries.map((entry) => (
        <li key={entry.label} className="flex shrink-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
