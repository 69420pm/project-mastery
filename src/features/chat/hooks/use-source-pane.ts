"use client";

import { createContext, useContext } from "react";
import type { PaneRequest } from "@/features/chat/types";

type SourcePaneContextValue = {
  /** The Chat's Course, whose chunk pages citations link to. */
  courseId: string;
  /** Opens a source or a Topic map in the pane, replacing what it shows. */
  openSource: (request: PaneRequest) => void;
};

/** The Chat's source pane, for citations in its messages to open. */
export const SourcePaneContext = createContext<SourcePaneContextValue | null>(
  null,
);

/** The Chat's source pane; null outside a Chat. */
export function useSourcePane() {
  return useContext(SourcePaneContext);
}
