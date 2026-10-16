"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { saveMemory } from "@/features/study/server/actions";
import { MAX_MEMORY_LENGTH } from "@/features/study/schemas";

/**
 * The Memory the AI keeps for a Course, in one textarea the Student edits,
 * clears and saves.
 */
export function MemoryCard({
  courseId,
  text,
}: {
  courseId: string;
  text: string;
}) {
  const [value, setValue] = useState(text);
  // The text the textarea started from: a refreshed `text` replaces the
  // value only while the Student has not edited it, so a draft survives.
  const [baseline, setBaseline] = useState(text);
  if (text !== baseline) {
    setBaseline(text);
    if (value === baseline) setValue(text);
  }
  const [status, setStatus] = useState<
    { kind: "saved" } | { kind: "error"; message: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveMemory({ courseId, text: value });
      // What was saved is now the text to compare a refresh against.
      if (result.ok) setBaseline(value);
      setStatus(
        result.ok
          ? { kind: "saved" }
          : {
              kind: "error",
              message: result.fieldErrors?.text?.[0] ?? result.message,
            },
      );
    });
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>What the AI knows about you</CardTitle>
          <CardDescription>
            The AI notes what helps it tutor you in this Course. Edit or delete
            anything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="Memory"
            value={value}
            maxLength={MAX_MEMORY_LENGTH}
            rows={8}
            placeholder="Nothing yet. The AI adds notes as you study."
            aria-invalid={status?.kind === "error"}
            onChange={(event) => {
              setValue(event.target.value);
              setStatus(null);
            }}
          />
        </CardContent>
        <CardFooter className="gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending && <Spinner data-icon="inline-start" />}
            Save
          </Button>
          {status?.kind === "saved" && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          )}
          {status?.kind === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {status.message}
            </p>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
