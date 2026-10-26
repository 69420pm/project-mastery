import "server-only";
import { loadChunkSources } from "@/features/ingestion/server";
import { TutorToolError } from "@/features/study/ai/tools";
import { meteredEmbed } from "@/features/usage/server";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/** The most chunks a search gives. */
const SEARCH_RESULTS = 4;

/** How many more chunks a search reads when it leaves some out. */
const OVERFETCH = 3;

/**
 * The Course's embedded chunks nearest to `query` by meaning, nearest first,
 * without the `excluded` ones (the reserved exam's). The query is embedded
 * like the chunks were, without an input type, and metered for the
 * signed-in Student. Throws a `TutorToolError` at the Daily limit.
 */
export async function searchChunks(
  supabase: Supabase,
  courseId: string,
  query: string,
  excluded: Set<string> = new Set(),
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
    p_count: excluded.size === 0 ? SEARCH_RESULTS : SEARCH_RESULTS * OVERFETCH,
  });
  if (error) failed("Searching the chunks", error);
  const ids = data
    .map(({ id }) => id)
    .filter((id) => !excluded.has(id))
    .slice(0, SEARCH_RESULTS);
  const chunks = await loadChunkSources(supabase, ids);
  // Nearest first, which `loadChunkSources` does not keep.
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
