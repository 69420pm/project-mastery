import { bigIdeaName } from "@/features/knowledge-map/domain/course-order";
import type { Link } from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  teachingOrder,
  topicOrder,
} from "@/features/knowledge-map/domain/topics";

/**
 * The map's structure from the Materials' structure, in code (#225): each
 * KC belongs to the Part of its first source in Course order; Parts with
 * enough KCs are Topics, smaller ones join a Topic of their chapter, larger
 * ones split; one Big idea per chapter title. KCs first sourced in an
 * exercise Part join the Topic holding most of their Exercises' other KCs.
 */

/** A Topic holds at least this many KCs of its own Part... */
const MIN_TOPIC_KCS = 3;
/** ...and a Part with more KCs splits in two. */
const MAX_TOPIC_KCS = 10;

export type PlanPart = {
  id: string;
  kind: "teaching" | "exercise";
  title: string;
  chapterTitle: string;
  contentHash: string;
};

/** A chunk of the Course, in Course order, with its Part and chapter. */
export type PlanChunk = { id: string; partId: string | null; chapter: string };

/** A live KC with its source chunk ids. */
export type PlanKc = { id: string; sources: readonly string[] };

/** A Topic of the plan, before it has a stored id. */
export type PlannedTopic = {
  /**
   * Its Parts' content hashes, sorted, which keep a stored Topic's id; a
   * half of a split Part is "<hash>/1" or "<hash>/2".
   */
  partHashes: string[];
  bigIdea: string;
  /** Its Parts' titles in Course order. */
  partTitles: string[];
  /** In teaching order. */
  kcs: string[];
};

export type MapPlan = {
  /** Big idea names, in Course order. */
  bigIdeas: string[];
  /** Every KC with a known source, by its first source in Course order. */
  kcs: Array<{ id: string; bigIdea: string }>;
  /** In Course order: Prerequisites first, then the earliest first source. */
  topics: PlannedTopic[];
};

type Draft = {
  /** Its place among the Parts, so Topics of one chapter keep their order. */
  at: number;
  chapter: string;
  parts: PlanPart[];
  hashes: string[];
  kcs: string[];
};

/**
 * The plan of the map. `parts` and `chunks` are in Course order;
 * `exercises` holds each Exercise's KC ids. A KC without a known source is
 * left out; one whose first source is in no Part is in no Topic, and its
 * Big idea is its chunk's chapter.
 */
export function planMap({
  parts,
  chunks,
  kcs,
  exercises,
  prerequisites,
}: {
  parts: readonly PlanPart[];
  chunks: readonly PlanChunk[];
  kcs: readonly PlanKc[];
  exercises: readonly (readonly string[])[];
  prerequisites: readonly Link[];
}): MapPlan {
  const place = new Map(chunks.map((chunk, index) => [chunk.id, index]));
  const placed = kcs
    .flatMap((kc) => {
      const places = kc.sources.flatMap((id) => place.get(id) ?? []);
      return places.length === 0
        ? []
        : [{ id: kc.id, first: Math.min(...places) }];
    })
    .toSorted((a, b) => a.first - b.first);
  const rank = new Map(placed.map((kc) => [kc.id, kc.first]));
  const partById = new Map(parts.map((part) => [part.id, part]));
  const partOf = new Map<string, PlanPart>();
  for (const kc of placed) {
    const part = partById.get(chunks[kc.first]!.partId ?? "");
    if (part) partOf.set(kc.id, part);
  }

  const mates = new Map<string, Set<string>>();
  for (const tested of exercises) {
    for (const kcId of tested) {
      const others = mates.get(kcId) ?? new Set();
      for (const other of tested) if (other !== kcId) others.add(other);
      mates.set(kcId, others);
    }
  }
  const matesOf = (kcId: string) => [...(mates.get(kcId) ?? [])];
  const joinsLater = (kcId: string) =>
    partOf.get(kcId)?.kind === "exercise" &&
    matesOf(kcId).some((mate) => partOf.get(mate)?.kind === "teaching");

  const kcsOfPart = new Map<string, string[]>();
  for (const kc of placed) {
    const part = partOf.get(kc.id);
    if (!part || joinsLater(kc.id)) continue;
    kcsOfPart.set(part.id, [...(kcsOfPart.get(part.id) ?? []), kc.id]);
  }

  const drafts: Draft[] = [];
  parts.forEach((part, at) => {
    const ids = kcsOfPart.get(part.id) ?? [];
    if (ids.length < MIN_TOPIC_KCS) return;
    const draft = (offset: number, hash: string, kcIds: string[]) => ({
      at: at + offset,
      chapter: part.chapterTitle,
      parts: [part],
      hashes: [hash],
      kcs: kcIds,
    });
    if (ids.length <= MAX_TOPIC_KCS) {
      drafts.push(draft(0, part.contentHash, ids));
      return;
    }
    const half = Math.ceil(ids.length / 2);
    drafts.push(
      draft(0, `${part.contentHash}/1`, ids.slice(0, half)),
      draft(0.5, `${part.contentHash}/2`, ids.slice(half)),
    );
  });
  parts.forEach((part, at) => {
    const ids = kcsOfPart.get(part.id) ?? [];
    if (ids.length === 0 || ids.length >= MIN_TOPIC_KCS) return;
    const chapter = drafts
      .filter((draft) => draft.chapter === part.chapterTitle)
      .toSorted((a, b) => a.at - b.at);
    const target =
      chapter.findLast((draft) => draft.at < at) ??
      chapter.find((draft) => draft.at > at);
    if (target) {
      target.parts.push(part);
      target.hashes.push(part.contentHash);
      target.kcs.push(...ids);
    } else {
      drafts.push({
        at,
        chapter: part.chapterTitle,
        parts: [part],
        hashes: [part.contentHash],
        kcs: ids,
      });
    }
  });
  drafts.sort((a, b) => a.at - b.at);

  const draftOf = new Map(
    drafts.flatMap((draft) => draft.kcs.map((id) => [id, draft] as const)),
  );
  for (const kc of placed.filter((kc) => joinsLater(kc.id))) {
    const counts = new Map<Draft, number>();
    for (const mate of matesOf(kc.id)) {
      const draft = draftOf.get(mate);
      if (draft) counts.set(draft, (counts.get(draft) ?? 0) + 1);
    }
    const best = drafts.reduce<Draft | null>(
      (found, draft) =>
        (counts.get(draft) ?? 0) > (found ? counts.get(found)! : 0)
          ? draft
          : found,
      null,
    );
    best?.kcs.push(kc.id);
  }

  const byRank = (ids: string[]) =>
    ids.toSorted((a, b) => rank.get(a)! - rank.get(b)!);
  const topics = drafts.map((draft) => ({
    partHashes: draft.hashes.toSorted(),
    bigIdea: bigIdeaName(draft.chapter),
    partTitles: draft.parts
      .toSorted((a, b) => parts.indexOf(a) - parts.indexOf(b))
      .map((part) => part.title),
    kcs: teachingOrder(byRank(draft.kcs), [...prerequisites]),
  }));
  const bigIdeaOf = new Map(
    topics.flatMap((topic) =>
      topic.kcs.map((id) => [id, topic.bigIdea] as const),
    ),
  );
  const ordered = placed.map((kc) => ({
    id: kc.id,
    bigIdea: bigIdeaOf.get(kc.id) ?? bigIdeaName(chunks[kc.first]!.chapter),
  }));
  return {
    bigIdeas: [...new Set(ordered.map((kc) => kc.bigIdea))],
    kcs: ordered,
    topics: topicOrder(topics, [...prerequisites], (id) => rank.get(id) ?? 0),
  };
}

/** Whether two Topics hold Parts with the same content hashes. */
export function sameParts(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((hash, index) => hash === b[index]);
}
