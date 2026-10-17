"use client";

import { Markdown } from "@/components/markdown";
import { STATE_NAMES } from "@/features/knowledge-map/domain/kc-labels";
import {
  KC_STATES,
  stateCounts,
} from "@/features/knowledge-map/domain/map-details";
import type {
  BigIdeaView,
  MapKcLearning,
} from "@/features/knowledge-map/types";
import { Fact, Section } from "./panel-parts";

/** One Big idea: its description and how many of its KCs are in each state. */
export function BigIdeaPanel({
  bigIdea,
  learning,
}: {
  bigIdea: BigIdeaView;
  learning: MapKcLearning;
}) {
  const counts = stateCounts(
    bigIdea.kcs.map((kc) => kc.id),
    learning,
  );
  return (
    <div className="flex flex-col gap-6 p-4">
      <Section title="Overview">
        <div className="text-lg font-semibold">
          <Markdown>{bigIdea.name}</Markdown>
        </div>
        <div className="text-sm text-muted-foreground">
          <Markdown>{bigIdea.description}</Markdown>
        </div>
      </Section>
      <Section title="KCs">
        <dl className="flex flex-col gap-1">
          <Fact label="All">{bigIdea.kcs.length}</Fact>
          {KC_STATES.map((state) => (
            <Fact key={state} label={STATE_NAMES[state]}>
              {counts[state]}
            </Fact>
          ))}
        </dl>
      </Section>
    </div>
  );
}
