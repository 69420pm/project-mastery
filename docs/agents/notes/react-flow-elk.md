# React Flow and ELK

Verified on 2026-10-16 with `elkjs` 0.12.0 (`lib/elk.bundled.js` in Node) and `@xyflow/react` 12.12.0.

- **Compound layout.** `elk.algorithm: layered` with `elk.hierarchyHandling: INCLUDE_CHILDREN` on the root lays out edges between children of different groups in one layering.
- **Child positions are relative to their group**, as React Flow's `parentId` expects: a child at `x: 10` sits 10 px right of its group's left edge.
- **Edges.** Each edge comes back with a `container`, its endpoints' lowest common ancestor, and its section coordinates are relative to that container. An edge declared on the root between two children of one group stays in the root's `edges` array but gets `container: <group>` and group-relative points. React Flow draws its own edges, so the map uses only node positions.
- **Leftmost nodes.** `elk.layered.layering.layerConstraint: FIRST` does not move an unlinked node, and with the default `elk.separateConnectedComponents: true` an unlinked node is packed as its own component anywhere. Prior knowledge uses `FIRST_SEPARATE` with `separateConnectedComponents: false`, which puts it leftmost, linked or not.
- **Worker.** `new ELK({ workerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)) })` from `elkjs/lib/elk-api` works under Turbopack (`src/features/knowledge-map/hooks/use-graph-layout.ts`). Tests import `elkjs/lib/elk.bundled.js`, which runs in-process.
- **React Flow in jsdom** needs a `ResizeObserver` stub (`knowledge-map.test.tsx`). Nodes given `width` and `height` render without measuring.
- **Edge z-order.** React Flow's default `zIndexMode: "basic"` raises an edge with an endpoint inside a parent node to that node's z, so Prerequisites into a Big idea draw above its box.
