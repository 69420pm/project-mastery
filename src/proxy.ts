import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Every path except static files, image optimization, metadata files,
    // common static assets, which never need a session, and Vercel
    // Workflow's internal routes, which the proxy would break.
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)",
  ],
};
