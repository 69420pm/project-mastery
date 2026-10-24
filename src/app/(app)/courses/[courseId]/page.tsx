import { redirect } from "next/navigation";
import { courseMapPath } from "@/features/knowledge-map";

/** A Course's own path leads to its home, the Course map. */
export default async function CoursePage({
  params,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  redirect(courseMapPath(courseId));
}
