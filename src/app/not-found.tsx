import { FileQuestionIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { COURSE_LIST_PATH } from "@/features/courses";

export const metadata: Metadata = {
  title: "Not found",
};

/** Any unknown page, and a Course, Chat or Material the Student can't see. */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <EmptyState
        className="w-full max-w-md border-none"
        heading="h1"
        icon={<FileQuestionIcon />}
        title="This page could not be found."
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild>
            <Link href={COURSE_LIST_PATH}>Go to your courses</Link>
          </Button>
        }
      />
    </main>
  );
}
