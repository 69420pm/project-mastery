import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * What a Student reads around a stored Topic (#175): its anchors, derived on
 * read from the map, and its Reading sections, which stage 2c cuts from the
 * chunks its KCs cite and stores (#178).
 */

/** The most pages one Reading section spans. */
export const MAX_SECTION_PAGES = 3;

/** A chunk's place: its Material, and the pages it covers. */
export type ChunkSpan = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
};

/** A part of a Topic's source pages, in one Material, as the cut gives it. */
export type SectionCut = {
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  chunkIds: string[];
};

/** How a Reading section is read. */
export type ReadingMode = "original" | "annotated" | "study_text";

/** The reason of a section no call judged. */
export const NOT_JUDGED_REASON = "Not judged yet.";

/** A stored Reading section (#178): its cut, mode and texts. */
export type ReadingSection = SectionCut & {
  id: string;
  mode: ReadingMode;
  reason: string;
  /** Notes on its pages, for the `annotated` mode. */
  annotations: Array<{ page: number; note: string }> | null;
  /** Markdown, for the `study_text` mode. */
  studyText: string | null;
};

/** A section of a Topic as stage 2c stores it; a null `id` is new. */
export type PlannedSection = {
  id: string | null;
  topicId: string;
  position: number;
  cut: SectionCut;
};

/**
 * Matches the stored sections to the cut of each Topic's sections. A stored
 * section of the same Topic with the same chunks keeps its id, whatever its
 * position; every other cut section is new. `deleted` holds the stored
 * sections no cut matches. The plan lists the Topics in the given order.
 */
export function matchSections(
  cuts: ReadonlyArray<{ topicId: string; sections: readonly SectionCut[] }>,
  stored: ReadonlyArray<{ id: string; topicId: string; chunkIds: string[] }>,
): { plan: PlannedSection[]; deleted: string[] } {
  const key = (topicId: string, chunkIds: readonly string[]) =>
    `${topicId}:${chunkIds.join(",")}`;
  const free = new Map<string, string>();
  for (const section of stored) {
    const sectionKey = key(section.topicId, section.chunkIds);
    if (!free.has(sectionKey)) free.set(sectionKey, section.id);
  }
  const kept = new Set<string>();
  const plan = cuts.flatMap(({ topicId, sections }) =>
    sections.map((cut, position): PlannedSection => {
      const sectionKey = key(topicId, cut.chunkIds);
      const id = free.get(sectionKey) ?? null;
      free.delete(sectionKey);
      if (id) kept.add(id);
      return { id, topicId, position, cut };
    }),
  );
  return {
    plan,
    deleted: stored.filter(({ id }) => !kept.has(id)).map(({ id }) => id),
  };
}

/** A planned section with the mode and texts it is stored with. */
export type SectionToStore = PlannedSection &
  Pick<ReadingSection, "mode" | "reason" | "annotations" | "studyText">;

/**
 * The sections stage 2c stores: a kept section with its stored mode and
 * texts, a new one `original` with the reason "Not judged yet.".
 */
export function sectionsToStore(
  cuts: Parameters<typeof matchSections>[0],
  stored: ReadonlyArray<ReadingSection & { topicId: string }>,
): SectionToStore[] {
  const byId = new Map(stored.map((section) => [section.id, section]));
  return matchSections(cuts, stored).plan.map((planned) => {
    const kept = planned.id ? byId.get(planned.id) : undefined;
    return {
      ...planned,
      mode: kept?.mode ?? "original",
      reason: kept?.reason ?? NOT_JUDGED_REASON,
      annotations: kept?.annotations ?? null,
      studyText: kept?.studyText ?? null,
    };
  });
}

/**
 * The Topic's anchors: Prerequisites of its KCs that sit outside it, prior
 * KCs included, each once, in map order.
 */
export function topicAnchors(
  kcIds: readonly string[],
  map: Pick<KnowledgeMap, "kcs" | "prerequisites">,
): Array<{ id: string; name: string }> {
  const inside = new Set(kcIds);
  const needed = new Set(
    map.prerequisites
      .filter((link) => inside.has(link.to) && !inside.has(link.from))
      .map((link) => link.from),
  );
  return map.kcs
    .filter((kc) => needed.has(kc.id))
    .map((kc) => ({ id: kc.id, name: kc.name }));
}

/**
 * The Topic's Reading sections: the chunks its KCs cite, each once, in
 * Material order (`chunks` is every chunk in reading order). A new section
 * starts when the Material changes or the section would span more than
 * `MAX_SECTION_PAGES` pages; a single chunk longer than that is a section
 * of its own.
 */
export function readingSections(
  sourceChunkIds: Iterable<string>,
  chunks: readonly ChunkSpan[],
): SectionCut[] {
  const wanted = new Set(sourceChunkIds);
  const sections: SectionCut[] = [];
  for (const chunk of chunks.filter((item) => wanted.has(item.id))) {
    const last = sections.at(-1);
    const pageTo = Math.max(chunk.pageTo, last?.pageTo ?? 0);
    if (
      last &&
      last.materialId === chunk.materialId &&
      pageTo - last.pageFrom + 1 <= MAX_SECTION_PAGES
    ) {
      last.pageTo = pageTo;
      last.chunkIds.push(chunk.id);
    } else {
      sections.push({
        materialId: chunk.materialId,
        materialName: chunk.materialName,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        chunkIds: [chunk.id],
      });
    }
  }
  return sections;
}
