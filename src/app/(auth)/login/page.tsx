import { CircleCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

  const message = getLoginMessage(params.message);

  return (
    <>
      <h1 className="sr-only">Sign in</h1>
      {message && (
        <Alert role="status">
          <CircleCheckIcon />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <LoginForms next={next} />
    </>
  );
}
