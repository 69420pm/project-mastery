import { handleTutorChat } from "@/features/tutor/server";

// Streaming answers, plus retries on rate limits, outlast the default timeout.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleTutorChat(request);
}
