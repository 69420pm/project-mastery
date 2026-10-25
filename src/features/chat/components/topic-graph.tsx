"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeMap } from "@/features/knowledge-map";
import { getTopicKnowledgeMap, type TopicKnowledgeMap } from "@/features/study";

type Loaded =
  | { status: "loading" }
  | { status: "open"; topic: TopicKnowledgeMap }
  | { status: "failed"; message: string };

/**
 * A Topic's KC graph with the Student's KC states, read when it mounts, as
 * the Chat's side slot shows it after a rebuild.
 */
export function TopicGraph({
  courseId,
  topicId,
}: {
  courseId: string;
  topicId: string;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void getTopicKnowledgeMap({ courseId, topicId }).then(
      (result) => {
        if (!current) return;
        setLoaded(
          result.ok
            ? { status: "open", topic: result.data }
            : { status: "failed", message: result.message },
        );
      },
      () =>
        current &&
        setLoaded({
          status: "failed",
          message: "The Knowledge map could not be opened. Please try again.",
        }),
    );
    return () => {
      current = false;
    };
  }, [courseId, topicId]);

  if (loaded.status === "loading") {
    return <Skeleton aria-label="Loading the Knowledge map" className="h-96" />;
  }
  if (loaded.status === "failed") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {loaded.message}
      </p>
    );
  }
  const { name, map, priorities, learning } = loaded.topic;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h3 className="text-sm font-medium">{name}</h3>
      <KnowledgeMap map={map} priorities={priorities} learning={learning} />
    </div>
  );
}
