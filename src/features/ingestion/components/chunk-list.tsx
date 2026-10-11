import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ChunkLabel,
  ChunkView,
  ExerciseSolution,
  MaterialChunks,
} from "@/features/ingestion/types";

const LABEL_NAMES: Record<ChunkLabel, string> = {
  content: "Content",
  definition: "Definition",
  example: "Example",
  exercise: "Exercise",
  solution: "Solution",
  figure: "Figure",
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

/** The anchor of a chunk in its Material's chunk view. */
const chunkAnchor = (chunkId: string) => `chunk-${chunkId}`;

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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link href={backHref}>
            <ArrowLeftIcon data-icon="inline-start" />
            Materials
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {material.name}
        </h1>
        {exam && (
          <p className="text-sm text-muted-foreground">
            Old exam
            {exam.year !== null && ` · ${exam.year}`}
            {exam.totalPoints !== null &&
              ` · ${formatPoints(exam.totalPoints)} in total`}
          </p>
        )}
      </div>

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
      className="flex scroll-mt-4 flex-col gap-3 rounded-xl border px-4 py-3 target:ring-2 target:ring-ring"
    >
      <header className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{LABEL_NAMES[chunk.label]}</Badge>
        <span>{pageRange(chunk)}</span>
        {chunk.exerciseNumber !== null && (
          <span>Exercise {chunk.exerciseNumber}</span>
        )}
        {chunk.points !== null && <span>{formatPoints(chunk.points)}</span>}
      </header>
      <Markdown className="min-w-0">{chunk.markdown}</Markdown>
      {chunk.figure && (
        <figure className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
          {chunk.figure.imageUrl && (
            // A short-lived signed Storage URL, so next/image has nothing to optimize.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chunk.figure.imageUrl}
              alt={chunk.figure.description}
              className="mb-2 max-h-96 w-auto max-w-full rounded-md border bg-white"
            />
          )}
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
        Solution
        {solution.exerciseNumber !== null && ` ${solution.exerciseNumber}`}
      </Link>
      <span className="text-muted-foreground"> in {solution.materialName}</span>
    </p>
  );
}
