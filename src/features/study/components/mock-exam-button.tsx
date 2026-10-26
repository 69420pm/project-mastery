"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { mockExamPath } from "@/features/study/domain/mock-paths";
import { queueMockExam } from "@/features/study/server/actions";

/**
 * Opens the Course's open Mock exam (`openHref`, Continue mock exam), or
 * queues a new one and opens its page (Mock exam, or `label`).
 */
export function MockExamButton({
  courseId,
  openHref,
  label = "Mock exam",
  variant = "outline",
}: {
  courseId: string;
  openHref: string | null;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (openHref) {
    return (
      <Button asChild size="sm" variant={variant}>
        <Link href={openHref}>Continue mock exam</Link>
      </Button>
    );
  }

  function queue() {
    setMessage(null);
    startTransition(async () => {
      const result = await queueMockExam({ courseId });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.push(mockExamPath(courseId, result.data.mockId));
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={isPending}
        onClick={queue}
      >
        {label}
      </Button>
      {message && (
        <p role="alert" className="w-full text-destructive">
          {message}
        </p>
      )}
    </>
  );
}
