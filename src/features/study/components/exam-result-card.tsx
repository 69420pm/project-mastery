"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveExamResult } from "@/features/study/server/actions";

/**
 * "How did the exam go?" on the map, once the Brief's exam date has passed:
 * a grade field with Save, and Skip, which records no grade. It is shown
 * for an exam date the Student has not answered.
 */
export function ExamResultCard({
  courseId,
  examDate,
}: {
  courseId: string;
  examDate: string;
}) {
  const [grade, setGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function answer(value: string | null) {
    startTransition(async () => {
      const result = await saveExamResult({
        courseId,
        examDate,
        grade: value,
      });
      setError(result.ok ? null : result.message);
    });
  }

  return (
    <Card
      role="region"
      aria-label="Exam result"
      className="w-full max-w-md gap-3 py-4 text-left"
    >
      <CardHeader className="px-4">
        <CardTitle>How did the exam go?</CardTitle>
        <CardDescription>
          Your exam was on {examDate}. Tell us your grade, if you know it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (grade.trim()) answer(grade.trim());
          }}
        >
          <Input
            aria-label="Your grade"
            value={grade}
            maxLength={50}
            onChange={(event) => setGrade(event.target.value)}
            placeholder="For example 1.7 or B+"
          />
          <Button type="submit" size="sm" disabled={isPending || !grade.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => answer(null)}
          >
            Skip
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
