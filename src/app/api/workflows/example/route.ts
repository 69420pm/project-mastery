import { handleStartExampleJob } from "@/features/workflow-example/server";

export async function POST(request: Request) {
  return handleStartExampleJob(request);
}
