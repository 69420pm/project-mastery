import "server-only";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { openingLine } from "@/features/study/domain/opening";
import { getKcStates } from "@/features/study/server/attempts";
import { createClient } from "@/lib/supabase/server";

/** A Course's new Chat description: its due reviews, or no map yet. */
export async function getOpeningLine(courseId: string): Promise<string> {
  const supabase = await createClient();
  const [map, states] = await Promise.all([
    loadStoredMap(supabase, courseId),
    getKcStates(courseId),
  ]);
  const dueCount = map.kcs.filter(
    (kc) => states[kc.id]?.state === "due",
  ).length;
  return openingLine(map.kcs.length > 0, dueCount);
}
