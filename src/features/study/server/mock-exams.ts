import "server-only";
import { z } from "zod";
import { getExamAids } from "@/features/brief/server";
import { examProfile } from "@/features/study/domain/exam-profile";
import { mockDeadline, mockStatus } from "@/features/study/domain/mock-paths";
import type { MockExamView, MockTask } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";

const OPEN = ["assembling", "ready", "in_progress"];

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * The id of the signed-in Student's open Mock exam of a Course (assembling,
 * ready or in progress), for Continue mock exam; null without one. A mock
 * assembling for over an hour is not open any more.
 */
export async function getOpenMockExam(
  courseId: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isUuid(courseId) || !(await getUser())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mock_exams")
    .select("id, status, failure, created_at")
    .eq("course_id", courseId)
    .in("status", OPEN);
  if (error) failed("Loading the open mock exam", error);
  const open = data.find((row) => mockStatus(row, now).status !== "failed");
  return open?.id ?? null;
}

/**
 * The signed-in Student's Mock exam of a Course with its item count, the
 * Brief's aids and, once started, its tasks with their answers; null when
 * the ids are malformed or it is unknown, another Student's or of another
 * Course (show not-found). A mock in progress whose time is up is
 * submitted first.
 */
export async function getMockExam(
  courseId: string,
  mockId: string,
  now: Date = new Date(),
): Promise<MockExamView | null> {
  if (!isUuid(courseId) || !isUuid(mockId) || !(await getUser())) return null;
  const supabase = await createClient();
  const load = () =>
    supabase
      .from("mock_exams")
      .select(
        "id, course_id, status, failure, created_at, started_at, gaps_total, gaps_done, duration_minutes, reserved_material_id, mock_items(position, prompt, points, question_id, questions(answer_text, confidence))",
      )
      .eq("id", mockId)
      .eq("course_id", courseId)
      .maybeSingle();
  let { data, error } = await load();
  if (error) failed("Loading the mock exam", error);
  if (!data) return null;

  let deadline =
    data.status === "in_progress" && data.started_at && data.duration_minutes
      ? mockDeadline(data.started_at, data.duration_minutes)
      : null;
  if (deadline && deadline <= now) {
    const submitted = await supabase.rpc("submit_mock_exam", {
      p_mock_id: mockId,
    });
    if (submitted.error) failed("Submitting the mock exam", submitted.error);
    ({ data, error } = await load());
    if (error) failed("Loading the mock exam", error);
    if (!data) return null;
    deadline = null;
  }

  const aids = await getExamAids(supabase, courseId);
  const tasks: MockTask[] = data.mock_items
    .toSorted((a, b) => a.position - b.position)
    .flatMap((item) =>
      item.question_id
        ? [
            {
              questionId: item.question_id,
              prompt: item.prompt,
              points: item.points,
              answer: item.questions?.answer_text ?? null,
              confidence: item.questions?.confidence ?? null,
            },
          ]
        : [],
    );
  return {
    id: data.id,
    courseId: data.course_id,
    ...mockStatus(data, now),
    gaps: { total: data.gaps_total, done: data.gaps_done },
    durationMinutes: data.duration_minutes,
    itemCount: data.mock_items.length,
    aids: examProfile(aids).aids,
    final: data.reserved_material_id !== null,
    deadline: deadline?.toISOString() ?? null,
    serverNow: now.toISOString(),
    tasks,
  };
}
