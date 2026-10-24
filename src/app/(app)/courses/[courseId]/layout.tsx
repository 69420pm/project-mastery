import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PathBreadcrumb } from "@/components/path-breadcrumb";
import { UserMenu } from "@/features/auth";
import { BriefLink, briefPath } from "@/features/brief";
import {
  ChatList,
  ChatListProvider,
  ChatTitle,
  NewChatLink,
  newChatPath,
} from "@/features/chat";
import { getChatList } from "@/features/chat/server";
import {
  COURSE_LIST_PATH,
  CourseSwitcher,
  MaterialsLink,
  materialsPath,
} from "@/features/courses";
import { getCourse, getCourseList } from "@/features/courses/server";
import {
  CourseMapLink,
  TopicTitle,
  courseMapPath,
} from "@/features/knowledge-map";
import { getTopicNames } from "@/features/knowledge-map/server";
import { getUser } from "@/lib/auth/user";
import { isSidebarOpen } from "@/lib/sidebar-state";

/**
 * Shell inside a Course: the sidebar shows the Course switcher, New chat,
 * Materials, the Brief, the Course map and the Course's Chats, and the top
 * bar where in the Course the page is. An unknown or another Student's
 * Course is not found.
 *
 * It only reads the user: each page calls `requireUser` with its own path, so
 * signing in returns there. Layouts also do not re-render on client
 * navigation within the Course, so they cannot guard pages.
 */
export default async function CourseLayout({
  children,
  params,
}: LayoutProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const [user, course, courses, chats, topicNames, cookieStore] =
    await Promise.all([
      getUser(),
      getCourse(courseId),
      getCourseList(),
      getChatList(courseId),
      getTopicNames(courseId),
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
              <BriefLink courseId={course.id} />
              <CourseMapLink courseId={course.id} />
            </>
          )
        }
        content={course && <ChatList />}
        breadcrumb={
          course && (
            <PathBreadcrumb
              trail={[
                { href: COURSE_LIST_PATH, label: "Courses" },
                { href: courseMapPath(course.id), label: course.name },
              ]}
              sections={[
                {
                  path: newChatPath(course.id),
                  label: "New chat",
                  exact: true,
                },
                { path: newChatPath(course.id), label: <ChatTitle /> },
                {
                  path: materialsPath(course.id),
                  label: "Materials",
                  href: materialsPath(course.id),
                },
                { path: briefPath(course.id), label: "Brief" },
                {
                  path: courseMapPath(course.id),
                  label: "Course map",
                  href: courseMapPath(course.id),
                  detail: (
                    <TopicTitle courseId={course.id} topics={topicNames} />
                  ),
                },
              ]}
            />
          )
        }
        footer={user && <UserMenu email={user.email} />}
      >
        {children}
      </AppShell>
    </ChatListProvider>
  );
}
