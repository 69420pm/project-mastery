import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Materials, materialsPath } from "@/features/courses";
import { getCourse, getMaterialList } from "@/features/courses/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Materials",
};

/** A Course's Materials: upload, open, rename and delete them. */
export default async function MaterialsPage({
  params,
}: PageProps<"/courses/[courseId]/materials">) {
  const { courseId } = await params;
  const user = await requireUser(materialsPath(courseId));
  const [course, materials] = await Promise.all([
    getCourse(courseId),
    getMaterialList(courseId),
  ]);
  if (!course) notFound();

  return (
    <Materials ownerId={user.id} courseId={course.id} materials={materials} />
  );
}
