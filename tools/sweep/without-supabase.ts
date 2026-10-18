/** Runs a command and resolves with its exit code and output. */
export type Run = (args: string[]) => Promise<{ code: number; out: string }>;

/**
 * Runs `work` with the local Supabase stack stopped, to free its memory for
 * the mutation runs. The unit tests mock the database. The stack comes back
 * afterwards if it was running; if this process is killed, `pnpm db:start`.
 */
export async function withoutSupabase(run: Run, work: () => Promise<void>) {
  const running = await run([
    "docker",
    "ps",
    "--quiet",
    "--filter",
    "name=supabase_db_",
  ])
    .then(({ out }) => out.trim() !== "")
    .catch(() => false);
  if (!running) return work();
  console.log("Stopping the local Supabase; it restarts when the run ends.");
  await run(["pnpm", "exec", "supabase", "stop"]);
  try {
    await work();
  } finally {
    await run(["pnpm", "exec", "supabase", "start"]);
  }
}
