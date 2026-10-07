import Link from "next/link";
import { UserMenu } from "@/features/auth";
import { getUser } from "@/lib/auth/user";

/**
 * Shell for signed-in pages. It only reads the user for the menu: each page
 * calls `requireUser` with its own path, so signing in returns there. Layouts
 * also do not re-render on client navigation, so they cannot guard pages.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Project Mastery
          </Link>
          {user && <UserMenu email={user.email} />}
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
        {children}
      </div>
    </div>
  );
}
