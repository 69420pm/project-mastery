"use client";

import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";

/** The pieces the map page's detail panels share. */

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function None({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A KC or Exercise named in a panel; clicking it selects that node. Renders
 * nothing for a node the map no longer has.
 */
export function NodeButton({
  node,
  onSelect,
}: {
  node: { id: string; name: string } | undefined;
  onSelect: (id: string) => void;
}) {
  if (!node) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className="text-left underline-offset-2 hover:underline"
    >
      <Markdown>{node.name}</Markdown>
    </button>
  );
}
