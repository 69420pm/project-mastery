import { Markdown } from "@/components/markdown";
import {
  type CheckItem,
  checkItems,
} from "@/features/knowledge-map/domain/focus";
import type { CheckReportView } from "@/features/knowledge-map/types";
import { cn } from "@/lib/utils";

/**
 * What the last build's checks found, or that they all passed, and the KCs
 * no Exercise tests and possible duplicate KCs, which fail no check. Each
 * item that names KCs is a button that highlights them on the graph:
 * `onToggle` gets its key, and `highlighted` is the pressed one's.
 */
export function CheckReport({
  report,
  highlighted,
  onToggle,
}: {
  report: CheckReportView;
  highlighted: string | null;
  onToggle: (key: string) => void;
}) {
  const items = new Map(checkItems(report).map((item) => [item.key, item]));
  const item = (key: string) => {
    const found = items.get(key);
    return (
      found && (
        <CheckItemButton
          item={found}
          pressed={highlighted === key}
          onToggle={onToggle}
        />
      )
    );
  };
  const findings = [
    report.uncoveredChunks.length > 0 && (
      <Markdown>{`Pages with content no KC covers: ${report.uncoveredChunks.join(", ")}`}</Markdown>
    ),
    item("ungrounded"),
    item("orphan"),
    item("cycles"),
    report.unmappedExercises.length > 0 && (
      <Markdown>{`Exercises without a KC: ${report.unmappedExercises.join(", ")}`}</Markdown>
    ),
  ].filter((finding) => finding !== false && finding !== undefined);
  const untested = item("untested");
  const duplicates = item("duplicates");
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
          {findings.map((finding, index) => (
            <li key={index}>{finding}</li>
          ))}
        </ul>
      )}
      {untested && <div className="text-muted-foreground">{untested}</div>}
      {duplicates && <div className="text-muted-foreground">{duplicates}</div>}
    </section>
  );
}

function CheckItemButton({
  item,
  pressed,
  onToggle,
}: {
  item: CheckItem;
  pressed: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={pressed ? "Clear the highlight" : "Highlight these KCs on the map"}
      onClick={() => onToggle(item.key)}
      className={cn(
        "block rounded-sm text-left underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        pressed && "text-foreground decoration-brand decoration-solid",
      )}
    >
      <Markdown>{item.text}</Markdown>
    </button>
  );
}
