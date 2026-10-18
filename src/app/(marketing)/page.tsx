import { redirect } from "next/navigation";
import { COURSE_LIST_PATH } from "@/features/courses";
import { getUser } from "@/lib/auth/user";

/**
 * The app has no public pages yet, so the root leads straight in: to the
 * Course list when signed in, and to sign in otherwise.
 */
export default async function Home() {
  redirect((await getUser()) ? COURSE_LIST_PATH : "/login");
}
