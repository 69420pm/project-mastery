import type {
  CheckReport,
  KnowledgeMap,
} from "@/features/knowledge-map/schemas";

/**
 * Step 4 and 5 of a Knowledge map build (`build-knowledge-map.ts`): the
 * links call's proposal joins the map, prerequisite cycles are broken,
 * redundant prerequisites go, and the check report lists what the map lacks.
 */

export type Prerequisite = KnowledgeMap["prerequisites"][number];
export type SemanticLink = KnowledgeMap["semanticLinks"][number];

/** What the links call proposes, by the map's KC ids. */
export type LinksProposal = {
  prerequisites: Prerequisite[];
  semanticLinks: SemanticLink[];
  /** Prior knowledge the material assumes, and the KCs that need it. */
  priorKcs: Array<{
    name: string;
    description: string;
    requiredBy: string[];
    extractionConfidence: number;
  }>;
};

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const edgeKey = (edge: { from: string; to: string }) =>
  `${edge.from}\u0000${edge.to}`;

/**
 * The prerequisite edges after breaking every cycle: while one exists, its
 * lowest-confidence edge goes (the first of equals, in cycle order).
 */
export function breakCycles(prerequisites: Prerequisite[]): {
  kept: Prerequisite[];
  dropped: Prerequisite[];
} {
  let kept = prerequisites;
  const dropped: Prerequisite[] = [];
  for (let cycle = findCycle(kept); cycle; cycle = findCycle(kept)) {
    const weakest = cycle.reduce((low, edge) =>
      edge.extractionConfidence < low.extractionConfidence ? edge : low,
    );
    dropped.push(weakest);
    kept = kept.filter((edge) => edge !== weakest);
  }
  return { kept, dropped };
}

/** The edges of one cycle in the graph, in order, or null when acyclic. */
function findCycle(edges: Prerequisite[]): Prerequisite[] | null {
  const out = adjacency(edges);
  const state = new Map<string, "open" | "done">();
  const path: Prerequisite[] = [];

  const visit = (node: string): Prerequisite[] | null => {
    state.set(node, "open");
    for (const edge of out.get(node) ?? []) {
      path.push(edge);
      const next = state.get(edge.to);
      if (next === "open") {
        return path.slice(path.findIndex((e) => e.from === edge.to));
      }
      if (next === undefined) {
        const cycle = visit(edge.to);
        if (cycle) return cycle;
      }
      path.pop();
    }
    state.set(node, "done");
    return null;
  };

  for (const edge of edges) {
    if (state.has(edge.from)) continue;
    const cycle = visit(edge.from);
    if (cycle) return cycle;
  }
  return null;
}

function adjacency(edges: Prerequisite[]) {
  const out = new Map<string, Prerequisite[]>();
  for (const edge of edges) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  }
  return out;
}

/**
 * The transitive reduction of an acyclic prerequisite graph: A→C goes when
 * a longer path A→B→…→C exists.
 */
export function withoutRedundant(
  prerequisites: Prerequisite[],
): Prerequisite[] {
  const out = adjacency(prerequisites);
  const reach = new Map<string, Set<string>>();
  const reachable = (node: string): Set<string> => {
    const known = reach.get(node);
    if (known) return known;
    const nodes = new Set<string>();
    for (const edge of out.get(node) ?? []) {
      nodes.add(edge.to);
      for (const further of reachable(edge.to)) nodes.add(further);
    }
    reach.set(node, nodes);
    return nodes;
  };
  return prerequisites.filter(
    (edge) =>
      !(out.get(edge.from) ?? []).some(
        (other) => other.to !== edge.to && reachable(other.to).has(edge.to),
      ),
  );
}

/**
 * The map with the proposal's links and prior KCs, and the prerequisite
 * edges dropped to break cycles. A prior KC named like a KC of the map is
 * that KC. Links that loop on one KC or name an unknown one go; a repeated
 * prerequisite keeps its highest confidence.
 */
export function withLinks(
  map: KnowledgeMap,
  proposal: LinksProposal,
): { map: KnowledgeMap; droppedCycleEdges: Prerequisite[] } {
  const kcs = [...map.kcs];
  const priorEdges: Prerequisite[] = [];
  for (const prior of proposal.priorKcs) {
    let kc = kcs.find((other) => sameName(other.name, prior.name));
    if (!kc) {
      kc = {
        id: `p${kcs.length + 1}`,
        name: prior.name,
        description: prior.description,
        type: "prior",
        bloom: null,
        bigIdea: null,
        origin: "prior",
        sources: [],
      };
      kcs.push(kc);
    }
    for (const to of prior.requiredBy) {
      priorEdges.push({
        from: kc.id,
        to,
        extractionConfidence: prior.extractionConfidence,
      });
    }
  }

  const ids = new Set(kcs.map((kc) => kc.id));
  const valid = (link: { from: string; to: string }) =>
    link.from !== link.to && ids.has(link.from) && ids.has(link.to);

  const strongest = new Map<string, Prerequisite>();
  for (const edge of [...proposal.prerequisites, ...priorEdges]) {
    if (!valid(edge)) continue;
    const known = strongest.get(edgeKey(edge));
    if (!known || edge.extractionConfidence > known.extractionConfidence) {
      strongest.set(edgeKey(edge), edge);
    }
  }
  const { kept, dropped } = breakCycles([...strongest.values()]);

  const semanticLinks = new Map<string, SemanticLink>();
  for (const link of proposal.semanticLinks) {
    const key = `${edgeKey(link)}\u0000${link.coreType}`;
    if (valid(link) && !semanticLinks.has(key)) semanticLinks.set(key, link);
  }

  return {
    map: {
      ...map,
      kcs,
      prerequisites: withoutRedundant(kept),
      semanticLinks: [...semanticLinks.values()],
    },
    droppedCycleEdges: dropped,
  };
}

/** The chunk labels every chunk of which some KC should cite. */
const COVERED_LABELS = new Set(["content", "definition"]);

/**
 * What the build's checks found in a linked map: `content` and
 * `definition` chunks no KC cites, non-prior KCs without a source, KCs
 * without any link, and the cycle edges dropped, all by KC name.
 */
export function checkMap(
  map: KnowledgeMap,
  chunks: Array<{ id: string; label: string }>,
  droppedCycleEdges: Prerequisite[],
): CheckReport {
  const cited = new Set(map.kcs.flatMap((kc) => kc.sources));
  const linked = new Set(
    [...map.prerequisites, ...map.semanticLinks].flatMap((link) => [
      link.from,
      link.to,
    ]),
  );
  const nameOf = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  const named = (id: string) => nameOf.get(id) ?? id;
  return {
    uncoveredChunkIds: chunks
      .filter(
        (chunk) => COVERED_LABELS.has(chunk.label) && !cited.has(chunk.id),
      )
      .map((chunk) => chunk.id),
    ungroundedKcs: map.kcs
      .filter((kc) => kc.origin !== "prior" && kc.sources.length === 0)
      .map((kc) => kc.name),
    orphanKcs: map.kcs.filter((kc) => !linked.has(kc.id)).map((kc) => kc.name),
    droppedCycleEdges: droppedCycleEdges.map((edge) => ({
      from: named(edge.from),
      to: named(edge.to),
      extractionConfidence: edge.extractionConfidence,
    })),
  };
}
