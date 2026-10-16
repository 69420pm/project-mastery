import { handleChatRequest } from "@/features/chat/server";

// A reply streams for up to 5 minutes, the most the Hobby plan allows. Usually
// it takes seconds; this is headroom for slow models on free tiers.
export const maxDuration = 300;

export function POST(request: Request) {
  return handleChatRequest(request);
}
