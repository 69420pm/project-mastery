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
 * or, with `tests`, the KCs its Exercises test (a KC from the exercise
 * call), in the Topic that holds most of them.
 */
export type TreeKc = {
  id: string;
  /** Its first source's Chapter; null without one. */
  chapterId: string | null;
  /** Only for a KC from the exercise call: the other KCs its Exercises test, once per Exercise. */
  tests?: string[];
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
 * The Chapter each KC is placed by: its own Chapter, except a KC from the
 * exercise call that tests alongside a KC placed so, which follows those
 * KCs' Topics instead (`placeKcs`) and so is left out here.
 */
export function kcChapters(kcs: TreeKc[]): Map<string, string> {
  const byChapter = new Set(
    kcs.filter((kc) => kc.tests === undefined).map((kc) => kc.id),
  );
  return new Map(
    kcs.flatMap((kc) =>
      kc.chapterId === null ||
      (kc.tests !== undefined && kc.tests.some((id) => byChapter.has(id)))
        ? []
        : [[kc.id, kc.chapterId] as const],
    ),
  );
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
 * Topic named by its title, at the end. KCs join their Chapter's Topic,
 * and a KC from the exercise call the Topic holding most of the KCs it is
 * tested with (the earlier on a tie). A Topic left with no KCs and no
 * children is dropped. A Topic keeps the stored id it continues when that
 * is one of `storedIds` and no earlier Topic took it.
 */
export function planTopicTree({
  proposed,
  chapters,
  kcs,
  storedIds,
}: {
  proposed: ProposedTopic[];
  /** The Course's Chapters in Course order. */
  chapters: Array<{ id: string; title: string }>;
  kcs: TreeKc[];
  storedIds: ReadonlySet<string>;
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
  for (const chapter of chapters) {
    if (!withKcs.has(chapter.id) || holder.has(chapter.id)) continue;
    const node: Node = {
      topic: {
        level: 1,
        name: chapter.title,
        chapterIds: [chapter.id],
        centralQuestion: "",
        continues: null,
      },
      chapterIds: [chapter.id],
      kcs: [],
      children: [],
    };
    holder.set(chapter.id, node);
    roots.push(node);
  }

  // KCs by Chapter, then those of the exercise call by majority.
  const topicOfKc = new Map<string, Node>();
  for (const kc of kcs) {
    const chapter = byChapter.get(kc.id);
    const node = chapter === undefined ? undefined : holder.get(chapter);
    if (node) topicOfKc.set(kc.id, node);
  }
  const order = preorder(roots);
  for (const kc of kcs) {
    if (topicOfKc.has(kc.id) || kc.tests === undefined) continue;
    const counts = new Map<Node, number>();
    for (const id of kc.tests) {
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
    if (best) topicOfKc.set(kc.id, best);
  }
  for (const kc of kcs) topicOfKc.get(kc.id)?.kcs.push(kc.id);

  // Empty Topics go, from the leaves up; then the plan in tree order.
  const prune = (nodes: Node[]): Node[] =>
    nodes.flatMap((node) => {
      node.children = prune(node.children);
      return node.kcs.length > 0 || node.children.length > 0 ? [node] : [];
    });
  const titleOf = new Map(chapters.map((c) => [c.id, c.title]));
  const plan: PlannedTopic[] = [];
  const taken = new Set<string>();
  const visit = (node: Node, parent: number | null) => {
    const { continues } = node.topic;
    const id =
      continues !== null && storedIds.has(continues) && !taken.has(continues)
        ? continues
        : null;
    if (id) taken.add(id);
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
  for (const root of prune(roots)) visit(root, null);
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
