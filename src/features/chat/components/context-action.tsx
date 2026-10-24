"use client";

import { ChevronRightIcon, ScrollTextIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { MessageAction } from "@/components/ai-elements/message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  dueReviewText,
  goalLabel,
  pacingText,
  phaseLabel,
} from "@/features/chat/domain/tutor-context";
import { tutorInstructions, type TutorContext } from "@/features/study";

/**
 * The Context action of an AI reply: a right-hand Sheet with the tutor
 * context the reply was given, as it was saved with it.
 */
export function ContextAction({ context }: { context?: TutorContext }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <MessageAction
        tooltip="Context"
        size="icon-xs"
        className="hover:text-foreground"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <ScrollTextIcon />
      </MessageAction>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Context</SheetTitle>
          <SheetDescription>
            What the AI was told about your study for this reply.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-4">
          {context ? (
            <ContextDetails context={context} />
          ) : (
            <Muted>Context not recorded for this reply</Muted>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ContextDetails({ context }: { context: TutorContext }) {
  const { dueReviews, candidates } = context;
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {(
          [
            ["Today", context.today],
            ["Exam date", context.examDate ?? "Not set"],
            ["Phase", phaseLabel(context.phase)],
            ["Goal", goalLabel(context.goal)],
            ["Pacing", pacingText(context)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Memory">
        {context.memory === "" ? (
          <Muted>No notes yet.</Muted>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{context.memory}</p>
        )}
      </Section>

      <Section title="Due reviews">
        {dueReviews.kcs.length === 0 ? (
          <Muted>None due.</Muted>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {dueReviews.kcs.map((kc) => (
              <li key={kc.id}>
                <span className="font-medium">{kc.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {kc.type} · {dueReviewText(kc)}
                </span>
              </li>
            ))}
            {dueReviews.more > 0 && (
              <li className="text-muted-foreground">
                and {dueReviews.more} more
              </li>
            )}
          </ul>
        )}
      </Section>

      <Section title="Candidates">
        {candidates.length === 0 ? (
          <Muted>
            {context.hasMap ? "No candidates." : "No Knowledge map yet."}
          </Muted>
        ) : (
          candidates.map(({ bigIdea, kcs }) => (
            <div key={bigIdea} className="flex flex-col gap-1 text-sm">
              <h3 className="font-medium">{bigIdea}</h3>
              <ul className="flex flex-col gap-1">
                {kcs.map((kc) => (
                  <li key={kc.id}>
                    {kc.name}
                    <span className="text-muted-foreground">
                      {" "}
                      · {kc.type} ·{" "}
                      {kc.anchors.length === 0
                        ? "no anchors"
                        : `anchors: ${kc.anchors.map(({ name }) => name).join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>

      <Collapsible className="text-sm">
        <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-4 transition-transform group-data-[state=open]:rotate-90" />
          Rendered with the current instructions
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {tutorInstructions(context)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
