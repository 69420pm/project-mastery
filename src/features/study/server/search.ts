import "server-only";
import { loadChunkSources } from "@/features/ingestion/server";
import { TutorToolError } from "@/features/study/ai/tools";
import { meteredEmbed } from "@/features/usage/server";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/** The most chunks a search gives. */
const SEARCH_RESULTS = 4;

/**
 * The Course's embedded chunks nearest to `query` by meaning, nearest first.
 * The query is embedded like the chunks were, without an input type, and
 * metered for the signed-in Student. Throws a `TutorToolError` at the Daily
 * limit.
 */
export async function searchChunks(
  supabase: Supabase,
  courseId: string,
  query: string,
) {
  const embedded = await meteredEmbed(
    supabase,
    { traceName: "tutor-search-materials" },
    { values: [query] },
  );
  if (!embedded) {
    throw new TutorToolError(
      "The Student's daily limit is reached, so the Materials can't be searched now: tutor without searching.",
    );
  }
  const { data, error } = await supabase.rpc("match_chunks", {
    p_course_id: courseId,
    p_embedding: JSON.stringify(embedded[0]),
    p_count: SEARCH_RESULTS,
  });
  if (error) failed("Searching the chunks", error);
  const chunks = await loadChunkSources(
    supabase,
    data.map(({ id }) => id),
  );
  // Nearest first, which `loadChunkSources` does not keep.
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return data.flatMap(({ id }) => byId.get(id) ?? []);
}
