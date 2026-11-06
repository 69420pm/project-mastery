/**
 * The Topic tree (#229): the rules that turn the tree call's answer, or the
 * stored tree, into the Topics a build stores. A Topic covers whole
 * Chapters; each Chapter with KCs sits in exactly one Topic, and each KC in
 * the Topic of its Chapter. Pure code.
 */

/** The most characters of a Topic name. */
export const MAX_TOPIC_NAME = 80;
const MAX_CENTRAL_QUESTION = 500;

/**
 * A Topic as the tree call proposes it, in a flat list in tree order: a
 * Topic's parent is the nearest earlier Topic with a lower `level`.
 */
export type ProposedTopic = {
  level: number;
  name: string;
  /** The Chapters whose KCs it holds itself. */
  chapterIds: string[];
  centralQuestion: string;
  /** The stored Topic it continues; null for a new one. */
  continues: string | null;
};

/** A Topic as a build stores it, in tree order. */
export type PlannedTopic = {
  /** The stored Topic it continues; null inserts one. */
  id: string | null;
  /** The index of its parent in the plan; null at the top. */
  parent: number | null;
  name: string;
  /** Null exactly when it holds no KCs of its own. */
  centralQuestion: string | null;
  chapterIds: string[];
  /** Its own KCs, in the order given. */
  kcs: string[];
};

/**
 * A live KC as the tree places it, in Course order: in its Chapter's Topic,
 * or, with `tests` (a KC from the exercise call), in the first of: the
 * Topic holding most of the KCs its Exercises test, the Topic of its
 * nearest placed KC by vector, its own Chapter's Topic.
 */
export type TreeKc = {
  id: string;
  /** Its first source's Chapter; null without one. */
  chapterId: string | null;
  /** Only for a KC from the exercise call: the other KCs its Exercises test, once per Exercise. */
  tests?: string[];
  /** Its embedding, to find the nearest placed KC of an exercise KC. */
  vector?: number[];
};

/** A stored Topic, as the tree reads it back. */
export type StoredTreeTopic = {
  id: string;
  parentId: string | null;
  name: string;
  centralQuestion: string | null;
  chapterIds: string[];
};

/**
 * The Chapter each KC is placed by: the own Chapter of a KC not from the
 * exercise call. A KC from the exercise call follows other KCs instead
 * (`planTopicTree`) and so is left out here; the tree call sees only the
 * Chapters this gives.
 */
export function kcChapters(kcs: TreeKc[]): Map<string, string> {
  return new Map(
    kcs.flatMap((kc) =>
      kc.chapterId === null || kc.tests !== undefined
        ? []
        : [[kc.id, kc.chapterId] as const],
    ),
  );
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * (b[i] ?? 0);
    normA += a[i]! ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** The stored tree as a proposal, so a build without a call keeps it. */
export function storedAsProposed(stored: StoredTreeTopic[]): ProposedTopic[] {
  const parentOf = new Map(stored.map((topic) => [topic.id, topic.parentId]));
  const depth = (id: string): number => {
    const parent = parentOf.get(id);
    return parent ? depth(parent) + 1 : 1;
  };
  return stored.map((topic) => ({
    level: depth(topic.id),
    name: topic.name,
    chapterIds: topic.chapterIds,
    centralQuestion: topic.centralQuestion ?? "",
    continues: topic.id,
  }));
}

type Node = {
  topic: ProposedTopic;
  chapterIds: string[];
  kcs: string[];
  children: Node[];
};

/**
 * The Topics to store from a proposed tree. Each Chapter with KCs goes to
 * the first Topic that names it; one no Topic names becomes a top-level
 * Topic named by its title, at the end. KCs join their Chapter's Topic. A
 * KC from the exercise call joins the first of: the Topic holding most of
 * the KCs it is tested with (the earlier on a tie), the Topic of its
 * nearest placed KC by vector, its own Chapter's Topic, which a Chapter no
 * Topic names gets as a top-level Topic. A Topic left with no KCs and no
 * children is dropped. A Topic keeps the stored id it continues when that
 * is one of `stored` and no earlier Topic took it. A stored Topic no
 * Topic continues is continued by the Topic holding most of its Chapters,
 * when that Topic continues no other.
 */
export function planTopicTree({
  proposed,
  chapters,
  kcs,
  stored,
}: {
  proposed: ProposedTopic[];
  /** The Course's Chapters in Course order. */
  chapters: Array<{ id: string; title: string }>;
  kcs: TreeKc[];
  stored: ReadonlyArray<Pick<StoredTreeTopic, "id" | "chapterIds">>;
}): PlannedTopic[] {
  const byChapter = kcChapters(kcs);
  const withKcs = new Set(byChapter.values());

  // The tree, from levels.
  const roots: Node[] = [];
  const stack: Node[] = [];
  const holder = new Map<string, Node>();
  for (const topic of proposed) {
    const node: Node = { topic, chapterIds: [], kcs: [], children: [] };
    for (const id of topic.chapterIds) {
      if (withKcs.has(id) && !holder.has(id)) {
        holder.set(id, node);
        node.chapterIds.push(id);
      }
    }
    while (stack.length > 0 && stack.at(-1)!.topic.level >= topic.level) {
      stack.pop();
    }
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  const titleOf = new Map(chapters.map((c) => [c.id, c.title]));
  // A top-level Topic named by the Chapter's title, for a Chapter no Topic names.
  const chapterTopic = (chapterId: string): Node | undefined => {
    const held = holder.get(chapterId);
    const title = titleOf.get(chapterId);
    if (held || title === undefined) return held;
    const node: Node = {
      topic: {
        level: 1,
        name: title,
        chapterIds: [chapterId],
        centralQuestion: "",
        continues: null,
      },
      chapterIds: [chapterId],
      kcs: [],
      children: [],
    };
    holder.set(chapterId, node);
    roots.push(node);
    return node;
  };
  for (const chapter of chapters) {
    if (withKcs.has(chapter.id)) chapterTopic(chapter.id);
  }

  // KCs by Chapter; then those of the exercise call by majority, nearest
  // placed KC and own Chapter.
  const topicOfKc = new Map<string, Node>();
  for (const kc of kcs) {
    const chapter = byChapter.get(kc.id);
    const node = chapter === undefined ? undefined : holder.get(chapter);
    if (node) topicOfKc.set(kc.id, node);
  }
  const order = preorder(roots);
  let pending = kcs.filter((kc) => kc.tests !== undefined);
  for (let grew = true; grew;) {
    grew = false;
    for (const kc of pending) {
      const counts = new Map<Node, number>();
      for (const id of kc.tests ?? []) {
        const node = topicOfKc.get(id);
        if (node) counts.set(node, (counts.get(node) ?? 0) + 1);
      }
      const best = order.reduce<Node | undefined>(
        (found, node) =>
          (counts.get(node) ?? 0) > (found ? counts.get(found)! : 0)
            ? node
            : found,
        undefined,
      );
      if (best) {
        topicOfKc.set(kc.id, best);
        grew = true;
      }
    }
    pending = pending.filter((kc) => !topicOfKc.has(kc.id));
  }
  const placed = kcs.flatMap((kc) =>
    topicOfKc.has(kc.id) && kc.vector
      ? [{ kc, node: topicOfKc.get(kc.id)! }]
      : [],
  );
  for (const kc of pending) {
    let best: { node: Node; similarity: number } | undefined;
    for (const other of placed) {
      const similarity = kc.vector ? cosine(kc.vector, other.kc.vector!) : 0;
      if (kc.vector && (!best || similarity > best.similarity)) {
        best = { node: other.node, similarity };
      }
    }
    const node =
      best?.node ??
      (kc.chapterId === null ? undefined : chapterTopic(kc.chapterId));
    if (node) topicOfKc.set(kc.id, node);
  }
  for (const kc of kcs) topicOfKc.get(kc.id)?.kcs.push(kc.id);

  // Empty Topics go, from the leaves up; then the plan in tree order.
  const prune = (nodes: Node[]): Node[] =>
    nodes.flatMap((node) => {
      node.children = prune(node.children);
      return node.kcs.length > 0 || node.children.length > 0 ? [node] : [];
    });
  const kept = prune(roots);

  // The stored id each Topic keeps: the one it continues, if stored and not
  // taken by an earlier Topic; then, for a stored Topic nothing continues,
  // the free Topic holding most of its Chapters.
  const storedIds = new Set(stored.map((topic) => topic.id));
  const idOf = new Map<Node, string>();
  const taken = new Set<string>();
  const nodes = preorder(kept);
  for (const node of nodes) {
    const { continues } = node.topic;
    if (
      continues !== null &&
      storedIds.has(continues) &&
      !taken.has(continues)
    ) {
      idOf.set(node, continues);
      taken.add(continues);
    }
  }
  for (const topic of stored) {
    if (taken.has(topic.id)) continue;
    let best: { node: Node; shared: number } | undefined;
    for (const node of nodes) {
      if (idOf.has(node)) continue;
      const shared = node.chapterIds.filter((id) =>
        topic.chapterIds.includes(id),
      ).length;
      if (shared > (best?.shared ?? 0)) best = { node, shared };
    }
    if (best) {
      idOf.set(best.node, topic.id);
      taken.add(topic.id);
    }
  }

  const plan: PlannedTopic[] = [];
  const visit = (node: Node, parent: number | null) => {
    const id = idOf.get(node) ?? null;
    const fallback = titleOf.get(node.chapterIds[0] ?? "") ?? "Topic";
    const name = node.topic.name.trim().slice(0, MAX_TOPIC_NAME) || fallback;
    const own = node.kcs.length > 0;
    const index = plan.length;
    plan.push({
      id,
      parent,
      name,
      centralQuestion: own
        ? node.topic.centralQuestion.trim().slice(0, MAX_CENTRAL_QUESTION) ||
          name
        : null,
      chapterIds: own ? node.chapterIds : [],
      kcs: node.kcs,
    });
    for (const child of node.children) visit(child, index);
  };
  for (const root of kept) visit(root, null);
  return plan;
}

function preorder(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => [node, ...preorder(node.children)]);
}

/**
 * A Topic's own id, then its ancestors' up to the top, from the Topics'
 * parents by id.
 */
export function topicLineage(
  topicId: string,
  parentOf: ReadonlyMap<string, string | null>,
): string[] {
  const lineage: string[] = [];
  for (
    let id: string | null | undefined = topicId;
    id && !lineage.includes(id);
    id = parentOf.get(id)
  ) {
    lineage.push(id);
  }
  return lineage;
}
