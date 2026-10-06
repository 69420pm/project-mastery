import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign-in link problem",
};

export default function AuthErrorPage() {
  return (
    <main>
      <h1>This link did not work</h1>
      <p>
        The sign-in or confirmation link is invalid or has expired. Links work
        once and only for a limited time.
      </p>
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
