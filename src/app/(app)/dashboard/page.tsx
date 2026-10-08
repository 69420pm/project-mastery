import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 pt-4 pb-10">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
      <p className="text-muted-foreground">
        Signed in as {user.email}. Your courses will appear here.
      </p>
    </div>
  );
}
