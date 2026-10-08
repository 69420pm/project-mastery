import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** A Supabase client typed with this project's schema, as `createClient` returns. */
export type Supabase = SupabaseClient<Database>;
