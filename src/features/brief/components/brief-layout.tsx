"use client";

import { PanelRightIcon } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/** Tailwind's `lg` breakpoint. */
const WIDE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Whether the viewport is `lg` or wider; false while rendering on the server. */
function useIsWide() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/**
 * The Brief page's layout: the conversation with the data panel beside it on
 * wide screens, and below `lg` the panel in a Sheet behind a "Brief data"
 * button. The panel is mounted once, so a Memory edit in progress is not
 * duplicated.
 */
export function BriefLayout({
  conversation,
  panel,
}: {
  conversation: ReactNode;
  panel: ReactNode;
}) {
  const isWide = useIsWide();

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-4">
        {/* Hidden up to hydration on wide screens, so it never flashes. */}
        <div className="flex px-4 pb-2 lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <PanelRightIcon data-icon="inline-start" />
                Brief data
              </Button>
            </SheetTrigger>
            {!isWide && (
              <SheetContent className="overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Brief data</SheetTitle>
                  <SheetDescription className="sr-only">
                    What the Brief holds and what follows from it.
                  </SheetDescription>
                </SheetHeader>
                {panel}
              </SheetContent>
            )}
          </Sheet>
        </div>
        {conversation}
      </div>
      {isWide && (
        <aside
          aria-label="Brief data"
          className="h-full w-96 shrink-0 overflow-y-auto border-l"
        >
          {panel}
        </aside>
      )}
    </div>
  );
}
