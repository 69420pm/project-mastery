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
import { goalLabel } from "@/features/chat/domain/tutor-context";
import { renderTutorContext, type TutorContext } from "@/features/study";

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
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {(
          [
            ["Today", context.today],
            ["Exam date", context.examDate ?? "Not set"],
            ["Goal", goalLabel(context.goal)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Memory">
        {context.notes.memory === "" ? (
          <Muted>No notes yet.</Muted>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{context.notes.memory}</p>
        )}
      </Section>

      <Collapsible className="text-sm">
        <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-4 transition-transform group-data-[state=open]:rotate-90" />
          As the AI read it
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {renderTutorContext(context)}
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
