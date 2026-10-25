"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pagesLabel } from "@/features/chat/domain/sources";
import { SourcePaneContext } from "@/features/chat/hooks/use-source-pane";
import { openSource } from "@/features/chat/server/actions";
import type {
  ChatSource,
  PaneRequest,
  SourceRequest,
} from "@/features/chat/types";
import { MaterialFile } from "@/features/courses";
import { useIsWide } from "@/hooks/use-is-wide";
import { cn } from "@/lib/utils";

type Loaded =
  | { status: "loading" }
  | { status: "open"; source: ChatSource }
  | { status: "failed"; message: string };

type ReadingMode = NonNullable<ChatSource["reading"]>["mode"];

const MODE_NAMES: Record<ReadingMode, string> = {
  original: "Original",
  annotated: "Annotated",
  study_text: "Study text",
};

/** Done on the reading cards, which the pane shows for the card it opened from. */
export type ReadingDone = {
  /** The reading cards that are done (`doneReadings`). */
  done: Set<string>;
  /** Whether a message could be sent now (`canAnswer`). */
  canDone: boolean;
  /** Sends "Done reading." for the section. */
  onDone: (sectionId: string) => void;
};

/**
 * The Chat's layout with its source pane beside the Chat's messages, which
 * citations and cards inside open through `useSourcePane`.
 */
export function WithSourcePane({
  courseId,
  reading,
  topicGraph,
  children,
}: {
  courseId: string;
  reading?: ReadingDone;
  /** Draws a Topic's KC graph, for a Knowledge map card to open. */
  topicGraph?: (topicId: string) => ReactNode;
  /** The Chat. */
  children: ReactNode;
}) {
  // What the pane shows; one source or Topic graph at a time.
  const [source, setSource] = useState<PaneRequest | null>(null);
  const pane = useMemo(() => ({ courseId, openSource: setSource }), [courseId]);
  return (
    <SourcePaneContext value={pane}>
      <div className="flex min-h-0 flex-1">
        {children}
        <SourcePane
          courseId={courseId}
          request={source}
          reading={reading}
          topicGraph={topicGraph}
          onClose={() => setSource(null)}
        />
      </div>
    </SourcePaneContext>
  );
}

/**
 * The Chat's source pane: one thing at a time, a Material's own pages from
 * the source's first page, a Reading section in its reading mode, or a
 * Topic's KC graph. From `lg` up it sits beside the Chat; below, it opens in
 * a Sheet. Null `request` closes it.
 */
export function SourcePane({
  courseId,
  request,
  reading,
  topicGraph,
  onClose,
}: {
  courseId: string;
  request: PaneRequest | null;
  reading?: ReadingDone;
  topicGraph?: (topicId: string) => ReactNode;
  onClose: () => void;
}) {
  const isWide = useIsWide();
  if (request === null) return null;
  // Keyed, so opening another source loads it afresh.
  const view =
    request.kind === "topic" ? (
      <TopicGraphView key={`topic:${request.id}`} onClose={onClose}>
        {topicGraph?.(request.id)}
      </TopicGraphView>
    ) : (
      <SourceView
        key={`${request.kind}:${request.id}:${request.cardId ?? ""}`}
        courseId={courseId}
        request={request}
        reading={reading}
        onClose={onClose}
      />
    );

  if (isWide) {
    return (
      <aside
        aria-label="Source"
        className={cn(
          "flex h-full shrink-0 flex-col border-l",
          request.kind === "topic" ? "w-[40rem]" : "w-[28rem]",
        )}
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

/** A Topic's KC graph (`children`) under the pane's header. */
function TopicGraphView({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="flex-1 truncate text-sm font-semibold">Knowledge map</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {children}
      </div>
    </>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Close source"
      onClick={onClose}
    >
      <XIcon />
    </Button>
  );
}

function SourceView({
  courseId,
  request,
  reading,
  onClose,
}: {
  courseId: string;
  request: SourceRequest;
  reading?: ReadingDone;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  // Null until the Student switches: the section's stored mode.
  const [chosenMode, setChosenMode] = useState<ReadingMode | null>(null);
  const { kind, id, cardId } = request;

  useEffect(() => {
    let current = true;
    void openSource({ courseId, kind, id }).then(
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
  }, [courseId, kind, id]);

  const source = loaded.status === "open" ? loaded.source : null;
  const modes = source?.reading ? readingModes(source.reading) : [];
  const mode = chosenMode ?? source?.reading?.mode ?? "original";
  const isDone = cardId !== undefined && reading?.done.has(cardId);
  return (
    <>
      <div className="flex flex-col gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2">
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
          {cardId !== undefined &&
            reading &&
            (isDone ? (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <CheckIcon className="size-4" />
                Read
              </span>
            ) : (
              <Button
                size="sm"
                disabled={!reading.canDone}
                onClick={() => reading.onDone(id)}
              >
                Done
              </Button>
            ))}
          <CloseButton onClose={onClose} />
        </div>
        {modes.length > 0 && (
          <Tabs
            value={mode}
            onValueChange={(value) => setChosenMode(value as ReadingMode)}
          >
            <TabsList aria-label="Reading mode">
              {modes.map((m) => (
                <TabsTrigger key={m} value={m}>
                  {MODE_NAMES[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
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
        {source &&
          (mode === "study_text" && source.reading?.studyText ? (
            <Markdown>{source.reading.studyText}</Markdown>
          ) : mode === "annotated" && source.reading?.annotations ? (
            <AnnotatedPages
              source={source}
              annotations={source.reading.annotations}
            />
          ) : (
            <MaterialFile
              materialId={source.materialId}
              name={source.materialName}
              page={source.pageFrom}
            />
          ))}
      </div>
    </>
  );
}

/** The modes a Reading section has a view for, Original always. */
function readingModes(
  reading: NonNullable<ChatSource["reading"]>,
): ReadingMode[] {
  return [
    "original",
    ...(reading.annotations ? (["annotated"] as const) : []),
    ...(reading.studyText !== null ? (["study_text"] as const) : []),
  ];
}

/** The PDF page with the notes on that page listed above it. */
function AnnotatedPages({
  source,
  annotations,
}: {
  source: ChatSource;
  annotations: Array<{ page: number; note: string }>;
}) {
  const [page, setPage] = useState(source.pageFrom);
  const notes = annotations.filter((annotation) => annotation.page === page);
  return (
    <div className="flex flex-col gap-3">
      {notes.length > 0 && (
        <ul
          aria-label={`Notes on page ${page}`}
          className="flex flex-col gap-2 rounded-md border bg-muted/50 p-3 text-sm"
        >
          {notes.map((annotation, i) => (
            <li key={i}>
              <Markdown>{annotation.note}</Markdown>
            </li>
          ))}
        </ul>
      )}
      <MaterialFile
        materialId={source.materialId}
        name={source.materialName}
        page={source.pageFrom}
        onPageChange={setPage}
      />
    </div>
  );
}
