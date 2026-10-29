"use client";

import { ChevronRightIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DIFFICULTY_NAMES,
  HELP_NAMES,
  RESULT_NAMES,
} from "@/features/knowledge-map/domain/kc-labels";
import { exerciseAttempts } from "@/features/knowledge-map/domain/map-details";
import type {
  ExerciseView,
  KcView,
  MapKcLearning,
} from "@/features/knowledge-map/types";
import { Fact, formatDate, NodeButton, None, Section } from "./panel-parts";

/**
 * Every stat about one Exercise: its difficulty and the KCs it tests, its
 * question, its printed solution, and the Student's attempts at it.
 * Clicking a KC calls `onSelect` with its id.
 */
export function ExercisePanel({
  exercise,
  kcs,
  learning,
  onSelect,
}: {
  exercise: ExerciseView;
  /** The map's KCs by id. */
  kcs: Map<string, KcView>;
  learning: MapKcLearning;
  onSelect: (id: string) => void;
}) {
  const attempts = exerciseAttempts(exercise.id, learning);
  return (
    <div className="flex flex-col gap-6 p-4">
      <Section title="Overview">
        <div className="text-lg font-semibold">
          <Markdown>{exercise.name}</Markdown>
        </div>
        <dl className="flex flex-col gap-1">
          <Fact label="Difficulty">
            {DIFFICULTY_NAMES[exercise.difficulty]}
          </Fact>
        </dl>
      </Section>

      <Section title="Tests">
        {exercise.kcs.length === 0 ? (
          <None>It tests no KC on the map.</None>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {exercise.kcs.map((id) => (
              <li key={id}>
                <NodeButton node={kcs.get(id)} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Question">
        {exercise.question ? (
          <div className="text-sm">
            <Markdown>{exercise.question}</Markdown>
          </div>
        ) : (
          <None>Its question is gone from the Materials.</None>
        )}
      </Section>

      <Section title="Solution">
        {exercise.solution ? (
          <Collapsible className="rounded-md border text-sm">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              Show the solution
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-3 py-2">
              <Markdown>{exercise.solution}</Markdown>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <None>No solution in the Materials</None>
        )}
      </Section>

      <Section title="Attempts">
        {attempts.length === 0 ? (
          <None>Not attempted yet.</None>
        ) : (
          <ul aria-label="Attempts" className="flex flex-col gap-1 text-sm">
            {attempts.map((attempt) => (
              <li
                key={`${attempt.createdAt}:${attempt.kcId}`}
                className="flex flex-wrap gap-x-2"
              >
                <span className="text-muted-foreground">
                  {formatDate(attempt.createdAt)}
                </span>
                <span>{RESULT_NAMES[attempt.result]}</span>
                <span className="text-muted-foreground">
                  {HELP_NAMES[attempt.help]}
                </span>
                <NodeButton node={kcs.get(attempt.kcId)} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
