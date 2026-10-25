"use client";

import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { pagesLabel } from "@/features/chat/domain/sources";
import { SourcePaneContext } from "@/features/chat/hooks/use-source-pane";
import { openSource } from "@/features/chat/server/actions";
import type { ChatSource, SourceRequest } from "@/features/chat/types";
import { MaterialFile } from "@/features/courses";
import { useIsWide } from "@/hooks/use-is-wide";

type Loaded =
  | { status: "loading" }
  | { status: "open"; source: ChatSource }
  | { status: "failed"; message: string };

/**
 * The Chat's layout with its source pane beside the conversation, which
 * citations and cards inside open through `useSourcePane`.
 */
export function WithSourcePane({
  courseId,
  children,
}: {
  courseId: string;
  /** The conversation. */
  children: ReactNode;
}) {
  // What the pane shows; one source at a time.
  const [source, setSource] = useState<SourceRequest | null>(null);
  const pane = useMemo(() => ({ courseId, openSource: setSource }), [courseId]);
  return (
    <SourcePaneContext value={pane}>
      <div className="flex min-h-0 flex-1">
        {children}
        <SourcePane
          courseId={courseId}
          request={source}
          onClose={() => setSource(null)}
        />
      </div>
    </SourcePaneContext>
  );
}

/**
 * The Chat's source pane: one source at a time, a Material's own pages from
 * the source's first page. From `lg` up it sits beside the conversation;
 * below, it opens in a Sheet. Null `request` closes it.
 */
export function SourcePane({
  courseId,
  request,
  onClose,
}: {
  courseId: string;
  request: SourceRequest | null;
  onClose: () => void;
}) {
  const isWide = useIsWide();
  if (request === null) return null;
  // Keyed, so opening another source loads it afresh.
  const view = (
    <SourceView
      key={`${request.kind}:${request.id}`}
      courseId={courseId}
      request={request}
      onClose={onClose}
    />
  );

  if (isWide) {
    return (
      <aside
        aria-label="Source"
        className="flex h-full w-[28rem] shrink-0 flex-col border-l"
      >
        {view}
      </aside>
    );
  }
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="w-full gap-0 sm:max-w-lg"
      >
        <SheetTitle className="sr-only">Source</SheetTitle>
        <section aria-label="Source" className="flex min-h-0 flex-1 flex-col">
          {view}
        </section>
      </SheetContent>
    </Sheet>
  );
}

function SourceView({
  courseId,
  request,
  onClose,
}: {
  courseId: string;
  request: SourceRequest;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let current = true;
    void openSource({ courseId, ...request }).then(
      (result) => {
        if (!current) return;
        setLoaded(
          result.ok
            ? { status: "open", source: result.data }
            : { status: "failed", message: result.message },
        );
      },
      () =>
        current &&
        setLoaded({
          status: "failed",
          message: "The source could not be opened. Please try again.",
        }),
    );
    return () => {
      current = false;
    };
  }, [courseId, request]);

  const source = loaded.status === "open" ? loaded.source : null;
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          {source && (
            <>
              <h2 className="truncate text-sm font-semibold">
                {source.materialName}
              </h2>
              <p className="text-xs text-muted-foreground">
                {pagesLabel(source.pageFrom, source.pageTo)}
              </p>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close source"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loaded.status === "loading" && (
          <Skeleton className="aspect-[1/1.414] w-full" />
        )}
        {loaded.status === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {loaded.message}
          </p>
        )}
        {source && (
          <MaterialFile
            materialId={source.materialId}
            name={source.materialName}
            page={source.pageFrom}
          />
        )}
      </div>
    </>
  );
}
