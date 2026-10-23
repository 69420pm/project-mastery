import { ReceiptIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  EVAL_SHARE,
  MONTHLY_CREDIT_USD,
  type BucketSpend,
  type MonthlyUsage,
} from "@/features/usage/domain/monthly-usage";
import { costText } from "@/lib/ai/cost";

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The Student's AI spend this month against the parts of the monthly credit,
 * then by Course. Without spend it says so.
 */
export function MonthlyUsageView({
  usage,
  month,
}: {
  usage: MonthlyUsage;
  /** The month shown, such as "October 2026". */
  month: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="AI usage"
        description={`Your AI spend in ${month} (UTC), against the $${MONTHLY_CREDIT_USD} monthly credit.`}
      />

      {usage.totalUsd === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title="No AI spend this month"
          description="Spend shows here once the AI has worked for you this month."
        />
      ) : (
        <>
          <section aria-label="Credit" className="grid gap-3 sm:grid-cols-2">
            {usage.buckets.map((bucket) => (
              <BucketCard key={bucket.bucket} spend={bucket} />
            ))}
          </section>
          {usage.otherUsd > 0 && (
            <p className="text-sm text-muted-foreground">
              Other tasks: {costText(usage.otherUsd)}
            </p>
          )}
          <section aria-labelledby="usage-by-course">
            <h2 id="usage-by-course" className="mb-3 font-medium">
              By course
            </h2>
            <ul className="divide-y rounded-xl border bg-card">
              {usage.courses.map((course) => (
                <li
                  key={course.courseId ?? "none"}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <span className="truncate">{course.name}</span>
                  <span className="tabular-nums">
                    {costText(course.spentUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="text-sm text-muted-foreground">
        Eval spend ({percent(EVAL_SHARE)} of the credit) is in{" "}
        <code>pnpm evals:report</code>.
      </p>
    </div>
  );
}

function BucketCard({ spend }: { spend: BucketSpend }) {
  const used = spend.budgetUsd > 0 ? spend.spentUsd / spend.budgetUsd : 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{spend.label}</h2>
        <span className="text-sm text-muted-foreground">
          {percent(spend.budgetUsd / MONTHLY_CREDIT_USD)} of the credit
        </span>
      </div>
      <p className="tabular-nums">
        {costText(spend.spentUsd)} of {costText(spend.budgetUsd)}
      </p>
      <div
        role="meter"
        aria-label={`${spend.label} spend`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used * 100)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={used > 1 ? "h-full bg-destructive" : "h-full bg-primary"}
          style={{ width: `${Math.min(used, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}
