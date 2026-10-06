import type { NextRequest } from "next/server";
import { confirmEmailLink } from "@/features/auth/server";

/** Target of the links in auth emails. */
export async function GET(request: NextRequest) {
  return confirmEmailLink(request);
}
