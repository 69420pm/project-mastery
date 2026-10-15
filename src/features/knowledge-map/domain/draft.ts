import {
  MAX_BIG_IDEAS,
  type BloomLevel,
  type KcType,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";

/**
 * The map an update drafts step by step (`build-knowledge-map.ts`), before
 * new KCs have a type and links. Stored big ideas and KCs keep their row
 * ids; new ones get ids local to the update: `b1`, `k1`, …; sources are chunk
 * ids.
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
 * The draft an update starts from: the stored map's big ideas and its taught
 * KCs with their sources. Prior KCs are left out, since no chunk teaches them.
 */
export function draftOf(map: KnowledgeMap): Draft {
  return {
    bigIdeas: map.bigIdeas,
    kcs: map.kcs.flatMap((kc) =>
      kc.bigIdea === null
        ? []
        : [
            {
              id: kc.id,
              name: kc.name,
              description: kc.description,
              bigIdea: kc.bigIdea,
              sources: kc.sources,
            },
          ],
    ),
  };
}

/** `<prefix><n>` for the first n past the item count that no item has. */
function freshId(prefix: string, items: Array<{ id: string }>): string {
  const taken = new Set(items.map((item) => item.id));
  let n = items.length + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * The `base` draft with a skeleton's new big ideas, while the draft holds
 * fewer than `MAX_BIG_IDEAS`, and their candidate KCs without sources. A big
 * idea named like one of the draft is that one, and a KC named like one of
 * the draft is left out, so the base stays as it is.
 */
export function draftFromSkeleton(
  skeleton: SkeletonProposal,
  base: Draft = { bigIdeas: [], kcs: [] },
): Draft {
  const draft: Draft = { bigIdeas: [...base.bigIdeas], kcs: [...base.kcs] };
  for (const bigIdea of skeleton.bigIdeas) {
    let id = draft.bigIdeas.find((other) =>
      sameName(other.name, bigIdea.name),
    )?.id;
    if (!id) {
      if (draft.bigIdeas.length >= MAX_BIG_IDEAS) continue;
      id = freshId("b", draft.bigIdeas);
      draft.bigIdeas.push({
        id,
        name: bigIdea.name,
        description: bigIdea.description,
      });
    }
    for (const kc of bigIdea.kcs) addKc(draft, { ...kc, bigIdea: id }, []);
  }
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
    id: freshId("k", draft.kcs),
    name: kc.name,
    description: kc.description,
    bigIdea: kc.bigIdea,
    sources: [...new Set(sources)],
  });
}

function addSources(kc: DraftKc, sources: string[]) {
  if (sources.every((source) => kc.sources.includes(source))) return;
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

/** The draft's KCs that `map` lacks, by big idea in draft order. */
export function newKcsOf(map: KnowledgeMap, draft: Draft): DraftKc[] {
  const stored = new Set(map.kcs.map((kc) => kc.id));
  return draft.bigIdeas.flatMap((bigIdea) =>
    kcsOf(draft, bigIdea.id).filter((kc) => !stored.has(kc.id)),
  );
}

/**
 * The map with the draft's big ideas, its KCs' sources and its new KCs with
 * their fill, after the map's KCs and without links yet. KCs of the map keep
 * everything else.
 */
export function withDraft(
  map: KnowledgeMap,
  draft: Draft,
  fills: Record<string, KcFill>,
): KnowledgeMap {
  const sources = new Map(draft.kcs.map((kc) => [kc.id, kc.sources]));
  return {
    ...map,
    bigIdeas: draft.bigIdeas,
    kcs: [
      ...map.kcs.map((kc) => ({
        ...kc,
        sources: sources.get(kc.id) ?? kc.sources,
      })),
      ...newKcsOf(map, draft).map((kc) => {
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
    ],
  };
}
