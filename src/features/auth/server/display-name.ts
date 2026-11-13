import "server-only";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/** The signed-in Student's name, or null when none is set. */
export async function getDisplayName(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  return data?.display_name ?? null;
}
