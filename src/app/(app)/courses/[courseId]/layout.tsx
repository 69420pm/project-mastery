import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { UserMenu } from "@/features/auth";
import { ChatList, ChatListProvider, NewChatLink } from "@/features/chat";
import { getChatList } from "@/features/chat/server";
import {
  COURSE_LIST_PATH,
  CourseSwitcher,
  MaterialsLink,
} from "@/features/courses";
import { getCourse, getCourseList } from "@/features/courses/server";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell inside a Course: the sidebar shows the Course switcher, New chat,
 * Materials and the Course's Chats. An unknown or another Student's Course is
 * not found.
 * It only reads the user: each page calls `requireUser` with its own path, so
 * signing in returns there. Layouts also do not re-render on client
 * navigation within the Course, so they cannot guard pages.
 */
export default async function CourseLayout({
  children,
  params,
}: LayoutProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const [user, course, courses, chats, cookieStore] = await Promise.all([
    getUser(),
    getCourse(courseId),
    getCourseList(),
    getChatList(courseId),
    cookies(),
  ]);
  // Signed out, the page sends the Student to sign in instead.
  if (user && !course) notFound();

  return (
    <ChatListProvider courseId={courseId} chats={chats}>
      <AppShell
        defaultOpen={isSidebarOpen(cookieStore)}
        homeHref={COURSE_LIST_PATH}
        header={
          course && (
            <>
              <CourseSwitcher course={course} courses={courses} />
              <NewChatLink />
              <MaterialsLink courseId={course.id} />
            </>
          )
        }
        content={course && <ChatList />}
        footer={user && <UserMenu email={user.email} />}
      >
        {children}
      </AppShell>
    </ChatListProvider>
  );
}
