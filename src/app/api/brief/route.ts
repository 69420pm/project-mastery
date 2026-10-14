import { handleBriefRequest } from "@/features/brief/server";

// A reply streams for up to a minute.
export const maxDuration = 60;

export function POST(request: Request) {
  return handleBriefRequest(request);
}
