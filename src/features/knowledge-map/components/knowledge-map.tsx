"use client";

import { RotateCwIcon, WaypointsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type {
  BloomLevel,
  KcType,
  SolutionStatus,
} from "@/features/knowledge-map/schemas";
import { startKnowledgeMapBuild } from "@/features/knowledge-map/server/actions";
import type {
  BigIdeaView,
  CheckReportView,
  ExerciseView,
  FindingView,
  KcView,
  KnowledgeMapView,
  MapBuild,
  SemanticLinkView,
} from "@/features/knowledge-map/types";

const TYPE_NAMES: Record<KcType, string> = {
  fact: "Fact",
  concept: "Concept",
  procedure: "Procedure",
  decision: "Decision",
  prior: "Prior knowledge",
};

const BLOOM_NAMES: Record<BloomLevel, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** How often the page refreshes while a build runs. */
const BUILD_POLL_MS = 2000;

/**
 * A Course's Knowledge map, read-only: the build's state with Build or
 * Update map and its check report, then each big idea with its KCs and their
 * prerequisites, the prior knowledge, the semantic links, the Exercises and
 * the Findings. The page refreshes itself while a build runs.
 */
export function KnowledgeMap({ map }: { map: KnowledgeMapView }) {
  const building = map.build?.status === "building";
  useBuildPolling(building);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Knowledge map
          </h1>
          <BuildButton
            courseId={map.courseId}
            hasMap={map.build?.finishedAt != null}
            disabled={!map.canBuild}
          />
        </div>
        <BuildStatus build={map.build} />
      </div>

      {map.checkReport && <CheckReport report={map.checkReport} />}

      {map.bigIdeas.length === 0 ? (
        <EmptyMap building={building} />
      ) : (
        <ol aria-label="Big ideas" className="flex flex-col gap-6">
          {map.bigIdeas.map((bigIdea) => (
            <BigIdea key={bigIdea.id} bigIdea={bigIdea} />
          ))}
        </ol>
      )}
      {map.priorKnowledge.length > 0 && (
        <PriorKnowledge kcs={map.priorKnowledge} />
      )}
      {map.semanticLinks.length > 0 && (
        <SemanticLinks links={map.semanticLinks} />
      )}
      {map.build?.finishedAt != null && <Exercises exercises={map.exercises} />}
      {map.findings.length > 0 && <Findings findings={map.findings} />}
    </div>
  );
}

function EmptyMap({ building }: { building: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <WaypointsIcon className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {building
          ? "The first map appears here when the build is done."
          : "Parse your materials, then build the map of what they teach."}
      </p>
    </div>
  );
}

function FormattedTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateFormat.format(new Date(iso))}
    </time>
  );
}

/** The last build's state: running, failed with its reason, or done. */
function BuildStatus({ build }: { build: MapBuild }) {
  const lastBuilt = build?.finishedAt && (
    <>
      Last built <FormattedTime iso={build.finishedAt} />
    </>
  );
  return (
    <div
      role="status"
      aria-label="Build status"
      className="flex flex-col gap-1 text-sm text-muted-foreground"
    >
      {build === null && <p>Not built yet.</p>}
      {build?.status === "building" && (
        <p className="flex items-center gap-2">
          <Spinner className="size-3" />
          Building…
        </p>
      )}
      {build?.status === "failed" && (
        <p className="text-destructive">Build failed: {build.failureReason}</p>
      )}
      {lastBuilt && <p>{lastBuilt}</p>}
    </div>
  );
}

/**
 * Starts a build: Build before the first map, Update map after, which maps
 * what Materials added or deleted since. Disabled while one runs or before a
 * Material is parsed.
 */
function BuildButton({
  courseId,
  hasMap,
  disabled,
}: {
  courseId: string;
  hasMap: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={disabled || isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await startKnowledgeMapBuild({ courseId });
            if (!result.ok) setError(result.message);
            router.refresh();
          })
        }
      >
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RotateCwIcon data-icon="inline-start" />
        )}
        {hasMap ? "Update map" : "Build knowledge map"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Refreshes the page's data while a build runs. */
function useBuildPolling(building: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => router.refresh(), BUILD_POLL_MS);
    return () => clearInterval(timer);
  }, [building, router]);
}

function BigIdea({ bigIdea }: { bigIdea: BigIdeaView }) {
  return (
    <li className="flex flex-col gap-3">
      <section aria-label={bigIdea.name} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {/* Not an h2: the markdown renders a paragraph, which h2 may not hold. */}
          <div role="heading" aria-level={2} className="text-lg font-semibold">
            <Markdown>{bigIdea.name}</Markdown>
          </div>
          <div className="text-sm text-muted-foreground">
            <Markdown>{bigIdea.description}</Markdown>
          </div>
        </div>
        <ul aria-label="Knowledge components" className="flex flex-col gap-2">
          {bigIdea.kcs.map((kc) => (
            <Kc key={kc.id} kc={kc} />
          ))}
        </ul>
      </section>
    </li>
  );
}

function Kc({ kc }: { kc: KcView }) {
  return (
    <li>
      <article
        aria-label={kc.name}
        className="flex flex-col gap-1.5 rounded-xl border px-4 py-3"
      >
        <div className="font-medium">
          <Markdown>{kc.name}</Markdown>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{TYPE_NAMES[kc.type]}</Badge>
          {kc.bloom && <Badge variant="outline">{BLOOM_NAMES[kc.bloom]}</Badge>}
          {kc.fromExercise && <Badge variant="outline">from an exercise</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">
          <Markdown>{kc.description}</Markdown>
        </div>
        {kc.prerequisites.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <Markdown>{`Needs: ${kc.prerequisites.join(", ")}`}</Markdown>
          </div>
        )}
        {kc.sources.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Sources: {kc.sources.join(", ")}
          </p>
        )}
      </article>
    </li>
  );
}

function PriorKnowledge({ kcs }: { kcs: KcView[] }) {
  return (
    <section aria-label="Prior knowledge" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Prior knowledge</h2>
        <p className="text-sm text-muted-foreground">
          What the materials assume you know already.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {kcs.map((kc) => (
          <Kc key={kc.id} kc={kc} />
        ))}
      </ul>
    </section>
  );
}

function SemanticLinks({ links }: { links: SemanticLinkView[] }) {
  return (
    <section aria-label="Semantic links" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Semantic links</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {links.map((link, index) => (
          <li key={index}>
            <Markdown>{`${link.from} → *${link.label}* → ${link.to}`}</Markdown>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_NAMES: Record<SolutionStatus, string> = {
  given: "Solution given",
  generated: "Solution generated",
  verified: "Solution verified",
  disputed: "Solution disputed",
};

const DIFFICULTY_NAMES = { 1: "Easy", 2: "Medium", 3: "Hard" } as const;

/** Every Exercise in reading order, with what it tests. */
function Exercises({ exercises }: { exercises: ExerciseView[] }) {
  return (
    <section aria-label="Exercises" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Exercises</h2>
      {exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The materials have no exercises.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exercises.map((exercise) => (
            <li key={exercise.id}>
              <article
                aria-label={exercise.name}
                className="flex flex-col gap-1.5 rounded-xl border px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{exercise.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {exercise.taskType}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant={
                      exercise.solutionStatus === "disputed"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {STATUS_NAMES[exercise.solutionStatus]}
                  </Badge>
                  <Badge variant="outline">
                    {DIFFICULTY_NAMES[exercise.difficulty]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Markdown>
                    {exercise.kcs.length > 0
                      ? `Tests: ${exercise.kcs.join(", ")}`
                      : "Tests no KC of the map."}
                  </Markdown>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the build found wrong in the materials, with where. */
function Findings({ findings }: { findings: FindingView[] }) {
  return (
    <section aria-label="Findings" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Findings</h2>
      <ul className="flex flex-col gap-2">
        {findings.map((finding) => (
          <li
            key={finding.id}
            className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm"
          >
            <Markdown>{finding.text}</Markdown>
            {finding.sources.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Sources: {finding.sources.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the last build's checks found, or that they all passed, and the KCs
 * no Exercise tests and possible duplicate KCs, which fail no check.
 */
function CheckReport({ report }: { report: CheckReportView }) {
  const findings = [
    report.uncoveredChunks.length > 0 &&
      `Pages with content no KC covers: ${report.uncoveredChunks.join(", ")}`,
    report.ungroundedKcs.length > 0 &&
      `KCs without a source: ${report.ungroundedKcs.join(", ")}`,
    report.orphanKcs.length > 0 &&
      `KCs without links: ${report.orphanKcs.join(", ")}`,
    report.droppedCycleEdges.length > 0 &&
      `Prerequisites dropped to break cycles: ${report.droppedCycleEdges
        .map((edge) => `${edge.from} → ${edge.to}`)
        .join(", ")}`,
    report.unmappedExercises.length > 0 &&
      `Exercises without a KC: ${report.unmappedExercises.join(", ")}`,
  ].filter((finding) => finding !== false);
  return (
    <section
      aria-label="Check report"
      className="flex flex-col gap-1.5 rounded-xl bg-muted/50 px-4 py-3 text-sm"
    >
      <h2 className="font-medium">Checks</h2>
      {findings.length === 0 ? (
        <p className="text-muted-foreground">All checks passed.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          {findings.map((finding) => (
            <li key={finding}>
              <Markdown>{finding}</Markdown>
            </li>
          ))}
        </ul>
      )}
      {report.untestedKcs.length > 0 && (
        <div className="text-muted-foreground">
          <Markdown>{`KCs no exercise tests: ${report.untestedKcs.join(", ")}`}</Markdown>
        </div>
      )}
      {report.duplicates.length > 0 && (
        <div className="text-muted-foreground">
          <Markdown>{`Possible duplicate KCs: ${report.duplicates
            .map((pair) => `${pair.a} and ${pair.b}`)
            .join("; ")}`}</Markdown>
        </div>
      )}
    </section>
  );
}
