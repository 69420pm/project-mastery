"use client";

import { type ReactNode, useId } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * An answer box: Markdown with LaTeX, a live preview once there is text,
 * and how sure the Student is, from 1 to 4 (tap again to clear). `children`
 * go at the end of the confidence row, such as a Submit button.
 */
export function AnswerField({
  text,
  onTextChange,
  onBlur,
  confidence,
  onConfidenceChange,
  invalid = false,
  disabled = false,
  children,
}: {
  text: string;
  onTextChange: (text: string) => void;
  /** When the Student leaves the box. */
  onBlur?: () => void;
  confidence: number | undefined;
  onConfidenceChange: (confidence: number | undefined) => void;
  invalid?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <Textarea
        id={id}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="Your answer, with $math$ in LaTeX…"
        aria-invalid={invalid}
        className="min-h-20"
      />
      {text.trim() !== "" && (
        <div
          aria-label="Preview"
          className="rounded-md border border-dashed px-3 py-2"
        >
          <Markdown>{text}</Markdown>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          role="radiogroup"
          aria-label="How sure are you?"
          className="mr-auto flex items-center gap-1.5"
        >
          <span className="text-muted-foreground" aria-hidden>
            How sure are you?
          </span>
          {[1, 2, 3, 4].map((value) => (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={confidence === value}
              aria-label={`Confidence ${value} of 4`}
              size="icon-sm"
              variant={confidence === value ? "default" : "outline"}
              disabled={disabled}
              onClick={() =>
                onConfidenceChange(confidence === value ? undefined : value)
              }
            >
              {value}
            </Button>
          ))}
        </div>
        {children}
      </div>
    </>
  );
}
