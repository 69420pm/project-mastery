import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chunkAnchor } from "@/features/ingestion/domain/chunk-anchor";
import type {
  ChunkLabel,
  ChunkView,
  ExerciseSolution,
  MaterialChunks,
} from "@/features/ingestion/types";

const LABEL_NAMES: Record<ChunkLabel, string> = {
  content: "Content",
  exercise: "Exercise",
  solution: "Solution",
  admin: "Admin",
};

function pageRange({ pageFrom, pageTo }: ChunkView): string {
  return pageFrom === pageTo
    ? `Page ${pageFrom}`
    : `Pages ${pageFrom}–${pageTo}`;
}

function formatPoints(points: number): string {
  return points === 1 ? "1 point" : `${points} points`;
}

type ChunkListProps = {
  material: MaterialChunks;
  /** Where "Back to materials" leads. */
  backHref: string;
  /** The chunk view of a Material of the same Course, for solution links. */
  materialHref: (materialId: string) => string;
};

/**
 * A parsed Material's chunks, read-only, in reading order: each with its
 * label, pages and markdown rendered like the AI's answers (math with KaTeX,
 * Mermaid as a code block).
 */
export function ChunkList({
  material,
  backHref,
  materialHref,
}: ChunkListProps) {
  const { exam } = material;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={
          <Button variant="ghost" size="sm" className="-ml-2.5 w-fit" asChild>
            <Link href={backHref}>
              <ArrowLeftIcon data-icon="inline-start" />
              Materials
            </Link>
          </Button>
        }
        title={material.name}
        description={
          exam && (
            <>
              Old exam
              {exam.year !== null && ` · ${exam.year}`}
              {exam.totalPoints !== null &&
                ` · ${formatPoints(exam.totalPoints)} in total`}
            </>
          )
        }
      />

      {material.chunks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {material.parseStatus === "parsed"
            ? "Parsing found no content in this material."
            : "This material has not been parsed yet."}
        </p>
      ) : (
        <ol aria-label="Chunks" className="flex flex-col gap-4">
          {material.chunks.map((chunk) => (
            <li key={chunk.id}>
              <ChunkCard chunk={chunk} materialHref={materialHref} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChunkCard({
  chunk,
  materialHref,
}: {
  chunk: ChunkView;
  materialHref: ChunkListProps["materialHref"];
}) {
  return (
    <article
      id={chunkAnchor(chunk.id)}
      aria-label={`${LABEL_NAMES[chunk.label]}, ${pageRange(chunk)}`}
      className="flex scroll-mt-4 flex-col gap-3 rounded-xl border bg-card px-5 py-4 text-sm target:ring-2 target:ring-ring"
    >
      <header className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{LABEL_NAMES[chunk.label]}</Badge>
        <span>{pageRange(chunk)}</span>
        {chunk.exerciseNumber !== null && (
          <span>Exercise {chunk.exerciseNumber}</span>
        )}
        {chunk.points !== null && <span>{formatPoints(chunk.points)}</span>}
      </header>
      {/* The chunk's own headings, scaled to the card. */}
      <Markdown className="min-w-0 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base">
        {chunk.markdown}
      </Markdown>
      {chunk.figure && (
        <figure className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <figcaption className="font-medium">Figure</figcaption>
          <p className="text-muted-foreground">{chunk.figure.description}</p>
        </figure>
      )}
      {chunk.solution && (
        <SolutionLine solution={chunk.solution} materialHref={materialHref} />
      )}
    </article>
  );
}

function SolutionLine({
  solution,
  materialHref,
}: {
  solution: ExerciseSolution;
  materialHref: ChunkListProps["materialHref"];
}) {
  if (solution.status === "no_solution") {
    return <p className="text-sm text-muted-foreground">No solution</p>;
  }
  const href = `${materialHref(solution.materialId)}#${chunkAnchor(solution.chunkId)}`;
  return (
    <p className="text-sm">
      <Link href={href} className="font-medium underline underline-offset-4">
        Solution in {solution.materialName}
      </Link>
    </p>
  );
}
