import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLoginMessage, LoginForms } from "@/features/auth";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  // Only the path matters here, so any origin works for the check.
  const next = safeRedirectPath(
    typeof params.next === "string" ? params.next : null,
    "http://localhost",
  );

  if (await getUser()) redirect(next);

  const error = getLoginMessage(params.error);
  const message = getLoginMessage(params.message);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <LoginForms next={next} />
    </main>
  );
}
