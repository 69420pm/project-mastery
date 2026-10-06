import "server-only";
import { start } from "workflow/api";
import { startExampleJobSchema } from "@/features/workflow-example/schemas";
import { exampleWorkflow } from "@/features/workflow-example/workflows/example";
import { isVercelDeployment } from "@/lib/deployment-env";

/**
 * Starts the example workflow and returns its run id, to try Workflow
 * locally (`pnpm dev`, then `pnpm exec workflow web`). Handles
 * `POST /api/workflows/example`. It has no auth, so it is disabled on every
 * Vercel deployment, previews included. Real jobs start from their feature's
 * Server Action or route, behind `requireUser`.
 */
export async function handleStartExampleJob(
  request: Request,
): Promise<Response> {
  if (isVercelDeployment()) {
    return new Response(null, { status: 404 });
  }

  const body = startExampleJobSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // `start` enqueues the run and returns at once; the job runs in the background.
  const run = await start(exampleWorkflow, [
    { jobId: crypto.randomUUID(), items: body.data.items },
  ]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
