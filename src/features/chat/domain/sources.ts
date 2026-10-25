import { materialsPath } from "@/features/courses";

const CHUNK_LINK = /^[^/?#]+#chunk-([0-9a-f-]{36})$/i;

/**
 * The chunk a link cites, when it links to a chunk on one of the Course's
 * chunk pages (`materialChunksPath` + `#chunk-…`); otherwise null.
 */
export function citedChunkId(
  href: string | undefined,
  courseId: string,
): string | null {
  const prefix = `${materialsPath(courseId)}/`;
  if (!href?.startsWith(prefix)) return null;
  return CHUNK_LINK.exec(href.slice(prefix.length))?.[1] ?? null;
}

/** Such as "p. 3" or "pp. 3–5". */
export function pagesLabel(pageFrom: number, pageTo: number): string {
  return pageFrom === pageTo ? `p. ${pageFrom}` : `pp. ${pageFrom}–${pageTo}`;
}
