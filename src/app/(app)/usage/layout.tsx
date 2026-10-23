import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PathBreadcrumb } from "@/components/path-breadcrumb";
import { UserMenu } from "@/features/auth";
import { COURSE_LIST_PATH, CourseListLink } from "@/features/courses";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell of the usage page, which the navigation does not link to. It only
 * reads the user: the page calls `requireUser` with its own path.
 */
export default async function UsageLayout({ children }: LayoutProps<"/usage">) {
  const [user, cookieStore] = await Promise.all([getUser(), cookies()]);

  return (
    <AppShell
      defaultOpen={isSidebarOpen(cookieStore)}
      homeHref={COURSE_LIST_PATH}
      header={<CourseListLink />}
      breadcrumb={
        <PathBreadcrumb trail={[{ href: "/usage", label: "Usage" }]} />
      }
      footer={user && <UserMenu email={user.email} />}
    >
      {children}
    </AppShell>
  );
}
