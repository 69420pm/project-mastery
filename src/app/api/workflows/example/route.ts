import { start } from "workflow/api";
import { z } from "zod";
import { exampleWorkflow } from "@/workflows/example";

const bodySchema = z.object({
  items: z.array(z.string().max(1000)).min(1).max(100),
});

/**
 * Starts the example workflow and returns its run id, to try Workflow
 * locally (`pnpm dev`, then `pnpm exec workflow web`). It has no auth, so
 * it is disabled on every Vercel deployment, previews included. Real jobs
 * start from their feature's route or Server Action, behind `requireUser`.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL) {
    return new Response(null, { status: 404 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // `start` enqueues the run and returns at once; the job runs in the background.
  const run = await start(exampleWorkflow, [
    { jobId: crypto.randomUUID(), items: body.data.items },
  ]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
