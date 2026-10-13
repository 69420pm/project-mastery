import {
  MAX_BIG_IDEAS,
  type BloomLevel,
  type KcType,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";

/**
 * The map a build drafts step by step (`build-knowledge-map.ts`), before
 * KCs have a type and links. Ids are local to the build: `b1`, `k1`, …;
 * sources are chunk ids.
 */
export type DraftBigIdea = { id: string; name: string; description: string };

export type DraftKc = {
  id: string;
  name: string;
  description: string;
  bigIdea: string;
  sources: string[];
};

export type Draft = { bigIdeas: DraftBigIdea[]; kcs: DraftKc[] };

/** What the skeleton call proposes. */
export type SkeletonProposal = {
  bigIdeas: Array<{
    name: string;
    description: string;
    kcs: Array<{ name: string; description: string }>;
  }>;
};

/** What an assignment call says about one batch of chunks. */
export type AssignmentProposal = {
  /** The KC ids each chunk teaches, by chunk id. */
  taught: Record<string, string[]>;
  newKcs: Array<{
    name: string;
    description: string;
    bigIdea: string;
    chunkIds: string[];
  }>;
};

/** What the fill call gives a content KC. */
export type KcFill = {
  type: Exclude<KcType, "prior">;
  bloom: BloomLevel;
  description: string;
};

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The draft of a skeleton: at most `MAX_BIG_IDEAS` big ideas, and their
 * candidate KCs without sources. A KC named like an earlier one is left out.
 */
export function draftFromSkeleton(skeleton: SkeletonProposal): Draft {
  const draft: Draft = { bigIdeas: [], kcs: [] };
  skeleton.bigIdeas.slice(0, MAX_BIG_IDEAS).forEach((bigIdea, index) => {
    const id = `b${index + 1}`;
    draft.bigIdeas.push({
      id,
      name: bigIdea.name,
      description: bigIdea.description,
    });
    for (const kc of bigIdea.kcs) addKc(draft, { ...kc, bigIdea: id }, []);
  });
  return draft;
}

/**
 * Adds a KC with these sources, or the sources to the KC of the same name.
 * Unknown big ideas are not added.
 */
function addKc(
  draft: Draft,
  kc: { name: string; description: string; bigIdea: string },
  sources: string[],
) {
  const existing = draft.kcs.find((other) => sameName(other.name, kc.name));
  if (existing) {
    addSources(existing, sources);
    return;
  }
  if (!draft.bigIdeas.some((bigIdea) => bigIdea.id === kc.bigIdea)) return;
  draft.kcs.push({
    id: `k${draft.kcs.length + 1}`,
    name: kc.name,
    description: kc.description,
    bigIdea: kc.bigIdea,
    sources: [...new Set(sources)],
  });
}

function addSources(kc: DraftKc, sources: string[]) {
  kc.sources = [...new Set([...kc.sources, ...sources])];
}

/**
 * The draft after one batch: each chunk becomes a source of the KCs it
 * teaches, and the batch's new KCs join, so later batches see them.
 */
export function applyAssignment(
  draft: Draft,
  proposal: AssignmentProposal,
): Draft {
  const next: Draft = {
    bigIdeas: draft.bigIdeas,
    kcs: draft.kcs.map((kc) => ({ ...kc, sources: [...kc.sources] })),
  };
  for (const [chunkId, kcIds] of Object.entries(proposal.taught)) {
    for (const kc of next.kcs) {
      if (kcIds.includes(kc.id)) addSources(kc, [chunkId]);
    }
  }
  for (const kc of proposal.newKcs) addKc(next, kc, kc.chunkIds);
  return next;
}

/**
 * The draft without candidates no chunk teaches, and without big ideas
 * left with no KC.
 */
export function withoutUnsourced(draft: Draft): Draft {
  const kcs = draft.kcs.filter((kc) => kc.sources.length > 0);
  return {
    bigIdeas: draft.bigIdeas.filter((bigIdea) =>
      kcs.some((kc) => kc.bigIdea === bigIdea.id),
    ),
    kcs,
  };
}

/** The KCs of one big idea, in draft order. */
export function kcsOf(draft: Draft, bigIdeaId: string): DraftKc[] {
  return draft.kcs.filter((kc) => kc.bigIdea === bigIdeaId);
}

/**
 * The map to store: big ideas in draft order, each followed by its KCs with
 * their fill, and no links yet.
 */
export function completeMap(
  draft: Draft,
  fills: Record<string, KcFill>,
): KnowledgeMap {
  return {
    bigIdeas: draft.bigIdeas,
    kcs: draft.bigIdeas.flatMap((bigIdea) =>
      kcsOf(draft, bigIdea.id).map((kc) => {
        const fill = fills[kc.id];
        if (!fill) throw new Error(`KC ${kc.id} was not filled.`);
        return {
          id: kc.id,
          name: kc.name,
          description: fill.description,
          type: fill.type,
          bloom: fill.bloom,
          bigIdea: kc.bigIdea,
          origin: "content" as const,
          sources: kc.sources,
        };
      }),
    ),
    prerequisites: [],
    semanticLinks: [],
    exercises: [],
    findings: [],
  };
}
