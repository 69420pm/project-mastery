import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MockExamStatus, mockExamPath } from "@/features/study";
import { getMockExam } from "@/features/study/server";
import { requireUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: "Mock exam",
};

/**
 * A Mock exam of the Course: its assembly, then what it holds. An unknown
 * mock, or another Student's, is not found.
 */
export default async function MockExamPage({
  params,
}: PageProps<"/courses/[courseId]/mock/[mockId]">) {
  const { courseId, mockId } = await params;
  await requireUser(mockExamPath(courseId, mockId));
  const mock = await getMockExam(courseId, mockId);
  if (!mock) notFound();

  return (
    <div className="flex justify-center p-4">
      <MockExamStatus mock={mock} />
    </div>
  );
}
