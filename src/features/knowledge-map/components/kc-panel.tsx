"use client";

import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BLOOM_NAMES,
  checkFlags,
  HELP_NAMES,
  ORIGIN_NAMES,
  RESULT_NAMES,
  TYPE_NAMES,
} from "@/features/knowledge-map/domain/kc-labels";
import { attemptedExercises } from "@/features/knowledge-map/domain/map-details";
import type {
  KcView,
  KnowledgeMapView,
  MapKcLearning,
  MapPriorities,
} from "@/features/knowledge-map/types";
import { PriorityBadge, PriorityReasons, StateBadge } from "./kc-priority";
import { Fact, formatDate, NodeButton, None, Section } from "./panel-parts";

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** A KC named in the panel; clicking it selects that KC. */
function KcButton({
  kc,
  onSelect,
}: {
  kc: KcView | undefined;
  onSelect: (kcId: string) => void;
}) {
  return <NodeButton node={kc} onSelect={onSelect} />;
}

/**
 * Every stat about one KC: what it is, what the Student has learned of it,
 * its Priority, its links, the chunks that teach it, the Exercises that test
 * it and what the checks say about it. Clicking a
 * linked KC or an Exercise calls `onSelect` with its id.
 */
export function KcPanel({
  kc,
  map,
  learning,
  priorities,
  onSelect,
}: {
  kc: KcView;
  map: KnowledgeMapView;
  learning: MapKcLearning;
  priorities: MapPriorities;
  onSelect: (kcId: string) => void;
}) {
  const kcs = new Map(
    [...map.bigIdeas.flatMap((b) => b.kcs), ...map.priorKnowledge].map((k) => [
      k.id,
      k,
    ]),
  );
  const bigIdea = map.bigIdeas.find((b) => b.kcs.some((k) => k.id === kc.id));
  const learned = learning[kc.id];
  const priority = priorities.kcs[kc.id];
  const exerciseName = new Map(map.exercises.map((e) => [e.id, e.name]));
  const attempted = attemptedExercises(learning);
  const needs = map.prerequisites.filter((link) => link.to === kc.id);
  const neededBy = map.prerequisites.filter((link) => link.from === kc.id);
  const semantic = map.semanticLinks.filter(
    (link) => link.from === kc.id || link.to === kc.id,
  );
  const exercises = map.exercises.filter((e) => e.kcs.includes(kc.id));
  const flags = checkFlags(map.checkReport, kc.name);

  return (
    <div className="flex flex-col gap-6 p-4">
      <Section title="Overview">
        <div className="text-lg font-semibold">
          <Markdown>{kc.name}</Markdown>
        </div>
        <div className="text-sm text-muted-foreground">
          <Markdown>{kc.description}</Markdown>
        </div>
        <dl className="flex flex-col gap-1">
          <Fact label="Type">{TYPE_NAMES[kc.type]}</Fact>
          {kc.bloom && <Fact label="Bloom level">{BLOOM_NAMES[kc.bloom]}</Fact>}
          <Fact label="Origin">{ORIGIN_NAMES[kc.origin]}</Fact>
          {bigIdea && (
            <Fact label="Big idea">
              <Markdown>{bigIdea.name}</Markdown>
            </Fact>
          )}
        </dl>
      </Section>

      <Section title="Learning">
        <dl className="flex flex-col gap-1">
          <Fact label="State">
            <StateBadge state={learned} />
          </Fact>
          {learned?.retrievability != null && (
            <Fact label="Recall today">
              {Math.round(learned.retrievability * 100)}%
            </Fact>
          )}
          {learned?.nextReview && (
            <Fact label="Next review">{formatDate(learned.nextReview)}</Fact>
          )}
        </dl>
        {learned && learned.attempts.length > 0 ? (
          <ul aria-label="Attempts" className="flex flex-col gap-1 text-sm">
            {learned.attempts.map((attempt, index) => (
              // Attempts are a fixed list per render, newest first.
              <li key={index} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">
                  {formatDate(attempt.createdAt)}
                </span>
                <span>{RESULT_NAMES[attempt.result]}</span>
                <span className="text-muted-foreground">
                  {HELP_NAMES[attempt.help]}
                </span>
                {attempt.exerciseId && (
                  <span className="text-muted-foreground">
                    {exerciseName.get(attempt.exerciseId) ?? "an Exercise"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <None>No attempts yet.</None>
        )}
      </Section>

      <Section title="Priority">
        {priority ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <PriorityBadge priority={priority} />
            </div>
            <dl className="flex flex-col gap-1">
              <Fact label="Value">{priority.value.toFixed(2)}</Fact>
              <Fact label="Multiplier">×{priority.multiplier}</Fact>
            </dl>
            <PriorityReasons priority={priority} />
          </>
        ) : (
          <None>No Priority yet.</None>
        )}
      </Section>

      <Section title="Links">
        <LinkList title="Needs" empty="No Prerequisites.">
          {needs.map((link) => (
            <li key={link.from} className="flex gap-2">
              <KcButton kc={kcs.get(link.from)} onSelect={onSelect} />
              <span className="text-muted-foreground">
                {percent(link.confidence)} sure
              </span>
            </li>
          ))}
        </LinkList>
        <LinkList title="Needed by" empty="No KC builds on it.">
          {neededBy.map((link) => (
            <li key={link.to} className="flex gap-2">
              <KcButton kc={kcs.get(link.to)} onSelect={onSelect} />
              <span className="text-muted-foreground">
                {percent(link.confidence)} sure
              </span>
            </li>
          ))}
        </LinkList>
        <LinkList title="Related" empty="No semantic links.">
          {semantic.map((link, index) => {
            // "this → label → other", or "other → label → this".
            const outgoing = link.from === kc.id;
            const label = (
              <span className="text-muted-foreground">
                {outgoing ? "→ " : ""}
                <i>{link.label}</i>
                {outgoing ? "" : " →"}
              </span>
            );
            const other = (
              <KcButton
                kc={kcs.get(outgoing ? link.to : link.from)}
                onSelect={onSelect}
              />
            );
            return (
              <li key={index} className="flex flex-wrap gap-x-2">
                {outgoing ? (
                  <>
                    {label}
                    {other}
                  </>
                ) : (
                  <>
                    {other}
                    {label}
                  </>
                )}
              </li>
            );
          })}
        </LinkList>
      </Section>

      <Section title="Sources">
        {kc.sources.length === 0 ? (
          <None>No chunk teaches it.</None>
        ) : (
          <ul className="flex flex-col gap-1">
            {kc.sources.map((source) => (
              <li key={source.chunkId}>
                <Collapsible className="rounded-md border text-sm">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                      <span className="truncate">
                        {source.material} {source.pages}
                      </span>
                    </CollapsibleTrigger>
                    <a
                      href={source.link}
                      aria-label={`Open ${source.material} ${source.pages}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  </div>
                  <CollapsibleContent className="border-t px-3 py-2">
                    <Markdown>{source.markdown}</Markdown>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Exercises">
        {exercises.length === 0 ? (
          <None>No Exercise tests it.</None>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {exercises.map((exercise) => (
              <li key={exercise.id} className="flex flex-wrap gap-x-2">
                <NodeButton node={exercise} onSelect={onSelect} />
                <span className="text-muted-foreground">
                  {attempted.has(exercise.id) ? "attempted" : "not attempted"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Flags">
        {flags.length > 0 ? (
          <ul aria-label="Check flags" className="flex flex-wrap gap-1.5">
            {flags.map((flag) => (
              <li key={flag}>
                <Badge variant="outline">{flag}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <None>The checks flag nothing.</None>
        )}
      </Section>
    </div>
  );
}

function LinkList({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <h4 className="font-medium">{title}</h4>
      {children.length === 0 ? (
        <None>{empty}</None>
      ) : (
        <ul className="flex flex-col gap-1">{children}</ul>
      )}
    </div>
  );
}
