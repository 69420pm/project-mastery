import "server-only";
import { materialChunksPath } from "@/features/courses/server";
import {
  chunkAnchor,
  type loadChunkSources,
} from "@/features/ingestion/server";
import type { SourceChunkView } from "@/features/study/types";

/** Such as "p. 3" or "pp. 3–4". */
export const pagesLabel = (from: number, to: number) =>
  from === to ? `p. ${from}` : `pp. ${from}–${to}`;

/** Such as "Lecture 3, pp. 12–14". */
export const readingLabel = (section: {
  materialName: string;
  pageFrom: number;
  pageTo: number;
}) =>
  `${section.materialName}, ${pagesLabel(section.pageFrom, section.pageTo)}`;

/** The chunk on its Material's page, where its figure shows. */
export const chunkLink = (
  courseId: string,
  chunk: { id: string; materialId: string },
) =>
  `${materialChunksPath(courseId, chunk.materialId)}#${chunkAnchor(chunk.id)}`;

/** A chunk as `getTopic` and `searchMaterials` return it. */
export const sourceView = (
  courseId: string,
  chunk: Awaited<ReturnType<typeof loadChunkSources>>[number],
): SourceChunkView => ({
  chunkId: chunk.id,
  material: chunk.materialName,
  pages: pagesLabel(chunk.pageFrom, chunk.pageTo),
  link: chunkLink(courseId, chunk),
  markdown: chunk.markdown,
});
