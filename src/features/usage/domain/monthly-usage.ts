import type { AiTask } from "@/lib/ai/models";

/** The AI credit a month runs on, in US dollars. */
export const MONTHLY_CREDIT_USD = 5;

/**
 * The parts of the monthly credit that Student spend draws on. The rest,
 * 25%, is eval spend, which `pnpm evals:report` shows.
 */
export const USAGE_BUCKETS = {
  study: { label: "Study", share: 0.6 },
  generation: { label: "Generation", share: 0.15 },
} as const;

export type UsageBucket = keyof typeof USAGE_BUCKETS;

/** The share of the credit eval spend draws on, outside the page's buckets. */
export const EVAL_SHARE = 0.25;

/**
 * Which bucket each task's spend counts against; `undefined` for tasks that
 * are never recorded for a Student. Generation has no task yet.
 */
const BUCKET_BY_TASK: Record<AiTask, UsageBucket | undefined> = {
  chat: "study",
  brief: "study",
  title: "study",
  ingest: "study",
  map: "study",
  exercise: "study",
  embed: "study",
  priority: "study",
  judge: undefined,
};

function bucketOf(task: string): UsageBucket | undefined {
  return Object.hasOwn(BUCKET_BY_TASK, task)
    ? BUCKET_BY_TASK[task as AiTask]
    : undefined;
}

/** One recorded AI call, with the Course of its Chat when it has one. */
export type UsageRecord = {
  task: string;
  costUsd: number;
  course: { id: string; name: string } | null;
};

export type BucketSpend = {
  bucket: UsageBucket;
  label: string;
  spentUsd: number;
  budgetUsd: number;
};

export type CourseSpend = {
  /** `null` for spend outside any Chat, which `ai_usage` keeps no Course for. */
  courseId: string | null;
  name: string;
  spentUsd: number;
};

export type MonthlyUsage = {
  totalUsd: number;
  buckets: BucketSpend[];
  /** Spend on tasks outside both buckets, such as ones no longer in use. */
  otherUsd: number;
  /** By Course, highest spend first, with spend outside Chats last. */
  courses: CourseSpend[];
};

/** 00:00 UTC on the first day of `now`'s month. */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Sums a month's records into the credit buckets and by Course. */
export function monthlyUsage(records: UsageRecord[]): MonthlyUsage {
  const byBucket = new Map<UsageBucket, number>();
  const byCourse = new Map<string | null, CourseSpend>();
  let totalUsd = 0;
  let otherUsd = 0;

  for (const { task, costUsd, course } of records) {
    totalUsd += costUsd;
    const bucket = bucketOf(task);
    if (bucket) byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + costUsd);
    else otherUsd += costUsd;

    const courseId = course?.id ?? null;
    const spend = byCourse.get(courseId) ?? {
      courseId,
      name: course?.name ?? "Outside Chats",
      spentUsd: 0,
    };
    spend.spentUsd += costUsd;
    byCourse.set(courseId, spend);
  }

  return {
    totalUsd,
    buckets: Object.entries(USAGE_BUCKETS).map(
      ([bucket, { label, share }]) => ({
        bucket: bucket as UsageBucket,
        label,
        spentUsd: byBucket.get(bucket as UsageBucket) ?? 0,
        budgetUsd: MONTHLY_CREDIT_USD * share,
      }),
    ),
    otherUsd,
    courses: [...byCourse.values()].toSorted((a, b) =>
      a.courseId === null
        ? 1
        : b.courseId === null
          ? -1
          : b.spentUsd - a.spentUsd,
    ),
  };
}
