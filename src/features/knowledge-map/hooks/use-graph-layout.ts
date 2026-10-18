import ELK, { type ElkNode } from "elkjs/lib/elk-api";
import { useEffect, useState } from "react";

let elk: InstanceType<typeof ELK> | null = null;

/** One ELK for the page, running in elkjs' own web worker. */
function getElk() {
  elk ??= new ELK({
    workerFactory: () =>
      new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)),
  });
  return elk;
}

export interface GraphLayout {
  /** The last finished layout; null until the first one is done. */
  laidOut: ElkNode | null;
  /** Whether the latest layout failed, so none is coming. */
  failed: boolean;
}

/**
 * `graph` laid out by ELK in a web worker. It lays out again only when
 * `graph`'s value changes, and keeps the last layout while the next one runs.
 */
export function useGraphLayout(graph: ElkNode): GraphLayout {
  const key = JSON.stringify(graph);
  const [layout, setLayout] = useState<GraphLayout>({
    laidOut: null,
    failed: false,
  });
  useEffect(() => {
    let current = true;
    getElk()
      .layout(JSON.parse(key) as ElkNode)
      .then((result) => {
        if (current) setLayout({ laidOut: result, failed: false });
      })
      .catch((error: unknown) => {
        console.error("Map layout failed", error);
        if (current) setLayout((last) => ({ ...last, failed: true }));
      });
    return () => {
      current = false;
    };
  }, [key]);
  return layout;
}
