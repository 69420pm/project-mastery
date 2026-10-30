/** A Prerequisite: `from` must be learned before `to`. */
export type Link = { from: string; to: string };

/**
 * The `added` links that keep the Prerequisites free of cycles, in order:
 * a link that would close a cycle with the stored links and the added ones
 * before it is dropped, so each cycle loses its newest link. Links already
 * there are left out.
 */
export function acyclicLinks(
  stored: readonly Link[],
  added: readonly Link[],
): Link[] {
  const next = new Map<string, Set<string>>();
  const link = ({ from, to }: Link) => {
    if (!next.has(from)) next.set(from, new Set());
    next.get(from)!.add(to);
  };
  stored.forEach(link);
  const reaches = (start: string, goal: string) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === goal) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(next.get(node) ?? []));
    }
    return false;
  };
  const kept: Link[] = [];
  for (const candidate of added) {
    if (candidate.from === candidate.to) continue;
    if (next.get(candidate.from)?.has(candidate.to)) continue;
    if (reaches(candidate.to, candidate.from)) continue;
    link(candidate);
    kept.push(candidate);
  }
  return kept;
}

/**
 * The redundant links of acyclic Prerequisites (transitive reduction): a
 * link from A to B is redundant when B is also reached from A through
 * other KCs.
 */
export function redundantLinks(links: readonly Link[]): Link[] {
  const next = new Map<string, string[]>();
  for (const { from, to } of links) {
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const reachedOtherwise = ({ from, to }: Link) => {
    const seen = new Set<string>();
    const stack = (next.get(from) ?? []).filter((node) => node !== to);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(next.get(node) ?? []));
    }
    return false;
  };
  return links.filter(reachedOtherwise);
}
