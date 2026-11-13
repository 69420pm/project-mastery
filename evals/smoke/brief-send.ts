import { randomUUID } from "node:crypto";
import { respondInBrief } from "@/features/brief/server";
import type { Supabase } from "@/lib/supabase/types";
import { readUIStream } from "./ui-stream";

/**
 * Sends `text` in the Course's Brief through the real Brief handler as the
 * Student whose session client `client` is, and returns the reply read
 * from its stream (`readUIStream`).
 */
export async function sendBriefMessage(
  client: Supabase,
  studentId: string,
  courseId: string,
  text: string,
) {
  const response = await respondInBrief({
    request: new Request("http://localhost/api/brief", {
      method: "POST",
      body: JSON.stringify({
        courseId,
        message: {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text }],
        },
      }),
    }),
    supabase: client,
    userId: studentId,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  return readUIStream(body);
}
