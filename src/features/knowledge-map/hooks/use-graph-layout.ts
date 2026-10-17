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

/**
 * `graph` laid out by ELK in a web worker; null until the first layout is
 * done. It lays out again only when `graph`'s value changes, and keeps the
 * last layout while the next one runs.
 */
export function useGraphLayout(graph: ElkNode): ElkNode | null {
  const key = JSON.stringify(graph);
  const [laidOut, setLaidOut] = useState<ElkNode | null>(null);
  useEffect(() => {
    let current = true;
    getElk()
      .layout(JSON.parse(key) as ElkNode)
      .then((result) => {
        if (current) setLaidOut(result);
      })
      .catch((error: unknown) => console.error("Map layout failed", error));
    return () => {
      current = false;
    };
  }, [key]);
  return laidOut;
}
