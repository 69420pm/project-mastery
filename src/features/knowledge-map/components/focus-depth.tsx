"use client";

import { FocusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FOCUS_DEPTHS,
  type FocusDepth,
} from "@/features/knowledge-map/domain/focus";

const DEPTH_NAMES: Record<FocusDepth, string> = {
  neighbours: "Neighbours",
  upstream: "Everything before",
  downstream: "Everything after",
  both: "Before and after",
};

/** How far focusing a node reaches, picked from a menu. */
export function FocusDepthMenu({
  depth,
  onChange,
}: {
  depth: FocusDepth;
  onChange: (depth: FocusDepth) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FocusIcon data-icon="inline-start" />
          Focus: {DEPTH_NAMES[depth]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Focus highlights</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={depth}
          onValueChange={(value) => onChange(value as FocusDepth)}
        >
          {FOCUS_DEPTHS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {DEPTH_NAMES[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
