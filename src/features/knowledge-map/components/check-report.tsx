import { Markdown } from "@/components/markdown";
import type { CheckReportView } from "@/features/knowledge-map/types";

/**
 * What the last build's checks found, or that they all passed, and the KCs
 * no Exercise tests and possible duplicate KCs, which fail no check.
 */
export function CheckReport({ report }: { report: CheckReportView }) {
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
