import "server-only";
import { getExamDate } from "@/features/brief/server";
import { materialChunksPath } from "@/features/courses";
import { chunkAnchor } from "@/features/ingestion";
import { loadChunkSources } from "@/features/ingestion/server";
import { knowledgeMapPath } from "@/features/knowledge-map";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  TutorToolError,
  tutorTools,
  type TutorToolActions,
  type TutorTools,
} from "@/features/study/ai/tools";
import { selectCandidates } from "@/features/study/domain/candidates";
import type { TutorContext } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;

/** The most source chunks `readKcs` gives per KC. */
const SOURCES_PER_KC = 3;

/**
 * What the AI tutors a reply in a Course's Chat with, read with `supabase`,
 * the Student's session client: the tutor context for its instructions and
 * its tools. Read on every reply, so both are current.
 */
export async function startTutoring(
  supabase: Supabase,
  courseId: string,
): Promise<{ context: TutorContext; tools: TutorTools }> {
  const [map, priorities, examDate] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamDate(supabase, courseId),
  ]);
  const hasMap = map.kcs.length > 0;
  return {
    context: {
      today: new Date().toISOString().slice(0, 10),
      examDate,
      hasMap,
      mapPath: knowledgeMapPath(courseId),
      candidates: hasMap ? selectCandidates(map, priorities) : [],
    },
    tools: tutorTools(tutorToolActions(supabase, courseId, map)),
  };
}

const pagesLabel = (from: number, to: number) =>
  from === to ? `p. ${from}` : `pp. ${from}–${to}`;

function tutorToolActions(
  supabase: Supabase,
  courseId: string,
  map: KnowledgeMap,
): TutorToolActions {
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  return {
    async readKcs(kcIds) {
      const unknown = kcIds.filter((id) => !kcById.has(id));
      if (unknown.length > 0) {
        throw new TutorToolError(
          `These are no KC ids of this Course: ${unknown.join(", ")}. Use the ids of the candidates and their anchors.`,
        );
      }
      const kcs = [...new Set(kcIds)].map((id) => kcById.get(id)!);
      const chunks = await loadChunkSources(
        supabase,
        kcs.flatMap((kc) => kc.sources),
      );
      return kcs.map((kc) => ({
        id: kc.id,
        name: kc.name,
        type: kc.type,
        description: kc.description,
        sources: chunks
          .filter((chunk) => kc.sources.includes(chunk.id))
          .slice(0, SOURCES_PER_KC)
          .map((chunk) => ({
            material: chunk.materialName,
            pages: pagesLabel(chunk.pageFrom, chunk.pageTo),
            link: `${materialChunksPath(courseId, chunk.materialId)}#${chunkAnchor(chunk.id)}`,
            markdown: chunk.markdown,
          })),
      }));
    },
  };
}
