import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { UserMenu } from "@/features/auth";
import { COURSE_LIST_PATH, CourseNav } from "@/features/courses";
import { getCourseList } from "@/features/courses/server";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell of the Course list: the sidebar lists the Student's Courses. It only
 * reads the user: the page calls `requireUser` with its own path, so signing
 * in returns there.
 */
export default async function CourseListLayout({
  children,
}: LayoutProps<"/courses">) {
  const [user, courses, cookieStore] = await Promise.all([
    getUser(),
    getCourseList(),
    cookies(),
  ]);

  return (
    <AppShell
      defaultOpen={isSidebarOpen(cookieStore)}
      homeHref={COURSE_LIST_PATH}
      content={<CourseNav courses={courses} />}
      footer={user && <UserMenu email={user.email} />}
    >
      {children}
    </AppShell>
  );
}
