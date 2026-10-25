"use client";

import { CheckIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { TopicStateName } from "@/features/study/domain/topic-state";
import { MAX_RATING_NOTE_LENGTH } from "@/features/study/schemas";
import {
  getSessionSummary,
  rateStudySession,
} from "@/features/study/server/actions";
import type { KcStateName, SessionSummary } from "@/features/study/types";

const TOPIC_STATE_NAMES: Record<TopicStateName, string> = {
  new: "New",
  in_progress: "In progress",
  learned: "Learned",
  solid: "Solid",
  needs_work: "Needs work",
};

const KC_STATE_NAMES: Record<KcStateName, string> = {
  new: "New",
  learning: "Learning",
  due: "Due",
  known: "Known",
};

/**
 * Where a learn session's composer was, at `close` or once it has ended:
 * the Topic's new state and each KC practised with its state and next
 * review, as if the session had ended, then a rating from 1 to 5 with an
 * optional note, and Start new session. Saving the rating ends the session.
 */
export function CloseCard({
  chatId,
  busy,
  newSessionHref,
  onRated,
}: {
  chatId: string;
  /** While a reply is on its way, the summary waits for it. */
  busy: boolean;
  newSessionHref: string;
  /** After the rating is saved, which ended the session. */
  onRated: () => void;
}) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (busy) return;
    let current = true;
    void getSessionSummary({ chatId }).then(
      (result) => {
        if (!current) return;
        if (result.ok) setSummary(result.data);
        else setFailed(result.message);
      },
      () => current && setFailed("The summary could not be loaded."),
    );
    return () => {
      current = false;
    };
  }, [chatId, busy]);

  return (
    <section
      aria-label="Session summary"
      data-testid="close-card"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border bg-card p-4 text-sm"
    >
      <h2 className="font-medium">
        {summary?.ended ? "Session ended" : "Session summary"}
      </h2>
      {failed && (
        <p role="alert" className="text-destructive">
          {failed}
        </p>
      )}
      {!summary && !failed && <Skeleton className="h-16" />}
      {summary && <SummaryFacts summary={summary} />}
      {summary && (
        <RatingForm
          // Remounts with the stored rating once it loads.
          key={`${summary.rating}:${summary.ratingNote}`}
          chatId={chatId}
          rating={summary.rating}
          note={summary.ratingNote}
          onRated={() => {
            setSummary({ ...summary, ended: true });
            onRated();
          }}
        />
      )}
      <Button size="sm" className="self-end" asChild>
        <Link href={newSessionHref}>
          <SquarePenIcon />
          Start new session
        </Link>
      </Button>
    </section>
  );
}

function SummaryFacts({ summary }: { summary: SessionSummary }) {
  const { topic, kcs } = summary;
  return (
    <div className="flex flex-col gap-3">
      {topic && (
        <p className="flex items-center gap-2">
          <span className="font-medium">{topic.name}</span>
          <Badge
            variant={topic.state === "needs_work" ? "destructive" : "secondary"}
            aria-label={`Topic state: ${TOPIC_STATE_NAMES[topic.state]}`}
          >
            {TOPIC_STATE_NAMES[topic.state]}
          </Badge>
        </p>
      )}
      {kcs.length > 0 && (
        <ul aria-label="KCs practised" className="flex flex-col gap-1.5">
          {kcs.map((kc) => (
            <li key={kc.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">{kc.name}</span>
              <Badge variant="outline">{KC_STATE_NAMES[kc.state]}</Badge>
              <span className="text-muted-foreground">
                {kc.nextReview
                  ? `Next review ${kc.nextReview}`
                  : "No review planned"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RatingForm({
  chatId,
  rating: stored,
  note: storedNote,
  onRated,
}: {
  chatId: string;
  rating: number | null;
  note: string | null;
  onRated: () => void;
}) {
  const [rating, setRating] = useState(stored ?? undefined);
  const [note, setNote] = useState(storedNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(stored !== null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const tooLong = note.length > MAX_RATING_NOTE_LENGTH;

  async function save() {
    if (rating === undefined || tooLong) return;
    setSaving(true);
    setError(null);
    try {
      const result = await rateStudySession({ chatId, rating, note });
      if (result.ok) {
        setSaved(true);
        onRated();
      } else {
        setError(result.message);
      }
    } catch {
      setError("The rating could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div
        role="radiogroup"
        aria-label="How was this session?"
        className="flex items-center gap-1.5"
      >
        <span className="mr-1 text-muted-foreground" aria-hidden>
          How was this session?
        </span>
        {[1, 2, 3, 4, 5].map((value) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`Rating ${value} of 5`}
            size="icon-sm"
            variant={rating === value ? "default" : "outline"}
            onClick={() => {
              setRating(value);
              setSaved(false);
            }}
          >
            {value}
          </Button>
        ))}
      </div>
      <label htmlFor={noteId} className="sr-only">
        Note
      </label>
      <Textarea
        id={noteId}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          setSaved(false);
        }}
        placeholder="Anything to add? (optional)"
        aria-invalid={tooLong}
        className="min-h-16"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {tooLong && (
          <p role="alert" className="mr-auto text-destructive">
            A note holds at most {MAX_RATING_NOTE_LENGTH} characters.
          </p>
        )}
        {error && (
          <p role="alert" className="mr-auto text-destructive">
            {error}
          </p>
        )}
        {saved ? (
          <span
            role="status"
            className="flex items-center gap-1 text-muted-foreground"
          >
            <CheckIcon className="size-4" />
            Rating saved
          </span>
        ) : (
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={rating === undefined || tooLong || saving}
          >
            Save rating
          </Button>
        )}
      </div>
    </form>
  );
}
