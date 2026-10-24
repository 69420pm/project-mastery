import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { topicPath } from "@/features/knowledge-map/domain/map-paths";
import { restrictMapToTopic } from "@/features/knowledge-map/domain/topic-map";
import type {
  KnowledgeMapView,
  MapKcLearning,
  MapPriorities,
  MapTopic,
  MapTopicDetail,
  MapTopicState,
} from "@/features/knowledge-map/types";
import { KnowledgeMap } from "./knowledge-map";
import { PlanBadges, RecallBar, TopicStateBadge } from "./topic-state";

/**
 * A Topic's page: its name, Big idea, Topic state and recall today, central
 * question and why it matters,
 * its anchors (each linking to the Topic that holds it; prior knowledge is
 * plain text), its KCs in teaching order, its Reading sections and the
 * Topics before and after it. Below sits the KC graph restricted to the
 * Topic and its anchors. `topics` are all the Course's Topics in Course
 * order; `map`, `priorities` and `learning` are what `KnowledgeMap` takes.
 * `controls` is the pin and skip slot below the badges.
 */
export function TopicDetail({
  courseId,
  topic,
  topics,
  map,
  priorities,
  learning,
  controls,
  topicState,
  badges,
}: {
  courseId: string;
  topic: MapTopicDetail;
  /** The Topic's state and recall today; undefined while it is new. */
  topicState?: MapTopicState;
  /** The study plan's badges of the Topic, such as "won't fit". */
  badges?: string[];
  topics: MapTopic[];
  map: KnowledgeMapView;
  priorities: MapPriorities;
  learning: MapKcLearning;
  controls?: ReactNode;
}) {
  const bigIdea = map.bigIdeas.find(({ id }) => id === topic.bigIdeaId);
  const index = topics.findIndex(({ id }) => id === topic.id);
  const previous = topics[index - 1];
  const next = topics[index + 1];
  const holder = (kcId: string) =>
    topics.find(({ kcs }) => kcs.some(({ id }) => id === kcId));

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 px-4 pt-8 pb-4 sm:px-6">
      <PageHeader
        title={topic.name}
        description={bigIdea && `Big idea: ${bigIdea.name}`}
      />
      <div className="flex max-w-sm items-end gap-3">
        <TopicStateBadge topicState={topicState} />
        <PlanBadges badges={badges} />
        <div className="flex-1">
          <RecallBar topicState={topicState} />
        </div>
      </div>
      {controls}

      <div className="flex max-w-3xl flex-col gap-4 text-sm">
        <Section title="Central question">
          <p>{topic.centralQuestion}</p>
        </Section>
        <Section title="Why it matters">
          <p>{topic.whyItMatters}</p>
        </Section>
        {topic.anchors.length > 0 && (
          <Section title="Anchors">
            <ul className="list-disc pl-5">
              {topic.anchors.map((anchor) => {
                const held = holder(anchor.id);
                return (
                  <li key={anchor.id}>
                    {held ? (
                      <Link
                        href={topicPath(courseId, held.id)}
                        className="underline underline-offset-2"
                      >
                        {anchor.name}
                      </Link>
                    ) : (
                      anchor.name
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        <Section title="KCs">
          <ol className="list-decimal pl-5">
            {topic.kcs.map((kc) => (
              <li key={kc.id}>{kc.name}</li>
            ))}
          </ol>
        </Section>
        {topic.readingSections.length > 0 && (
          <Section title="Reading">
            <ul className="list-disc pl-5">
              {topic.readingSections.map((section) => (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    className="underline underline-offset-2"
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <nav
        aria-label="Topics in order"
        className="flex flex-wrap justify-between gap-3 text-sm"
      >
        {previous ? (
          <Link
            href={topicPath(courseId, previous.id)}
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            <ArrowLeftIcon className="size-4" />
            Previous: {previous.name}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={topicPath(courseId, next.id)}
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Next: {next.name}
            <ArrowRightIcon className="size-4" />
          </Link>
        )}
      </nav>

      <div className="flex h-[36rem] flex-col">
        <KnowledgeMap
          map={restrictMapToTopic(map, topic)}
          priorities={priorities}
          learning={learning}
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}
