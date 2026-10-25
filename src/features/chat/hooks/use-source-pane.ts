"use client";

import { createContext, useContext } from "react";
import type { SourceRequest } from "@/features/chat/types";

type SourcePaneContextValue = {
  /** The Chat's Course, whose chunk pages citations link to. */
  courseId: string;
  /** Opens a source in the pane, replacing the one it shows. */
  openSource: (request: SourceRequest) => void;
};

/** The Chat's source pane, for citations in its messages to open. */
export const SourcePaneContext = createContext<SourcePaneContextValue | null>(
  null,
);

/** The Chat's source pane; null outside a Chat. */
export function useSourcePane() {
  return useContext(SourcePaneContext);
}
