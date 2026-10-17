"use client";

import { Panel, useReactFlow } from "@xyflow/react";
import { MaximizeIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

/** The graph's zoom in, zoom out and fit-to-view buttons, bottom left. */
export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left">
      <ButtonGroup orientation="vertical" aria-label="Zoom">
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom in"
          onClick={() => void zoomIn()}
        >
          <ZoomInIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom out"
          onClick={() => void zoomOut()}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Fit the map to the view"
          onClick={() => void fitView()}
        >
          <MaximizeIcon />
        </Button>
      </ButtonGroup>
    </Panel>
  );
}
