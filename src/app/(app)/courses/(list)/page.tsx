import type { Metadata } from "next";
import { CourseList } from "@/features/courses";
import { getCourseList } from "@/features/courses/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Courses",
};

/** The Student's Course list, where they land after signing in. */
export default async function CoursesPage() {
  await requireUser("/courses");
  const courses = await getCourseList();

  return <CourseList courses={courses} />;
}
