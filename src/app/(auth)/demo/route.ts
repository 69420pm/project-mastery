import { signInDemo } from "@/features/auth/server";

/** The demo link: signs into the shared demo account. */
export async function GET() {
  return signInDemo();
}
