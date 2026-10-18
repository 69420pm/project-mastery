import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PathBreadcrumb } from "@/components/path-breadcrumb";
import { UserMenu } from "@/features/auth";
import { COURSE_LIST_PATH, CourseListLink } from "@/features/courses";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell of the Course list. The page lists the Courses, so the sidebar only
 * links to it. It only reads the user: the page calls `requireUser` with its
 * own path, so signing in returns there.
 */
export default async function CourseListLayout({
  children,
}: LayoutProps<"/courses">) {
  const [user, cookieStore] = await Promise.all([getUser(), cookies()]);

  return (
    <AppShell
      defaultOpen={isSidebarOpen(cookieStore)}
      homeHref={COURSE_LIST_PATH}
      header={<CourseListLink />}
      breadcrumb={
        <PathBreadcrumb
          trail={[{ href: COURSE_LIST_PATH, label: "Courses" }]}
        />
      }
      footer={user && <UserMenu email={user.email} />}
    >
      {children}
    </AppShell>
  );
}
