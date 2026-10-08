import { handleChatRequest } from "@/features/chat/server";

// A reply streams for up to a minute.
export const maxDuration = 60;

export function POST(request: Request) {
  return handleChatRequest(request);
}
