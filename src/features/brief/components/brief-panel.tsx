import Link from "next/link";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import type { BriefFields } from "@/features/brief/domain/intake";
import type { BriefWithMessages } from "@/features/brief/types";

const timeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dayFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const GOAL_NAMES = {
  pass: "Pass",
  good_grade: "A good grade",
  master_everything: "Master everything",
} as const;

const QUESTION_STYLE_NAMES = {
  written: "Written",
  multiple_choice: "Multiple choice",
  mixed: "Mixed",
} as const;

const yesNo = (value: boolean) => (value ? "Yes" : "No");

function Time({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {timeFormat.format(new Date(iso))}
    </time>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 py-5 first-of-type:border-t-0"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const None = () => <p className="text-sm text-muted-foreground">None</p>;

function MaterialLinks({
  materials,
}: {
  materials: Array<{ id: string; name: string; href: string }>;
}) {
  if (materials.length === 0) return <None />;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {materials.map((material) => (
        <li key={material.id}>
          <Link href={material.href} className="underline underline-offset-4">
            {material.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything the Brief holds and what follows from it, beside its
 * conversation: the exam facts, the excluded Materials, the old exams, the
 * exam scope, the notes, the study plan and the Memory (slots, since the
 * study feature that owns them depends on this one).
 */
export function BriefPanel({
  brief,
  plan,
  memory,
}: {
  brief: Pick<
    BriefWithMessages,
    | "fields"
    | "notes"
    | "notesUpdatedAt"
    | "excludedMaterials"
    | "oldExams"
    | "examScopes"
    | "reservedExam"
  >;
  plan: ReactNode;
  memory: ReactNode;
}) {
  return (
    <div className="flex flex-col divide-y px-5">
      <h1 className="sr-only">Brief data</h1>
      <Section title="Exam">
        <ExamFacts fields={brief.fields} />
        {brief.reservedExam && (
          <p className="text-sm">
            <span className="text-muted-foreground">Reserved exam: </span>
            {brief.reservedExam === "none" ? (
              "None"
            ) : (
              <Link
                href={brief.reservedExam.href}
                className="underline underline-offset-4"
              >
                {brief.reservedExam.name}
              </Link>
            )}
          </p>
        )}
      </Section>
      <Section title="Excluded Materials">
        <MaterialLinks materials={brief.excludedMaterials} />
      </Section>
      <Section title="Old exams">
        <MaterialLinks materials={brief.oldExams} />
      </Section>
      <Section title="Exam scope">
        {brief.examScopes.length === 0 ? (
          <None />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {brief.examScopes.map((scope) => (
              <li key={scope.name}>
                <span className="font-medium">
                  {scope.scope === "excluded" ? "Excluded" : "Emphasized"}:
                </span>{" "}
                {scope.name}
                <span className="text-muted-foreground">
                  {" "}
                  · “{scope.words}”
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Notes">
        {brief.notes ? (
          <div className="flex flex-col gap-1 text-sm">
            <Markdown>{brief.notes}</Markdown>
            {brief.notesUpdatedAt && (
              <p className="text-xs text-muted-foreground">
                Updated <Time iso={brief.notesUpdatedAt} />
              </p>
            )}
          </div>
        ) : (
          <None />
        )}
      </Section>
      <Section title="Study plan">{plan}</Section>
      <Section title="Memory">{memory}</Section>
    </div>
  );
}

function ExamFacts({ fields }: { fields: BriefFields }) {
  const rows: Array<[string, string | null]> = [
    [
      "Date",
      fields.examDate &&
        dayFormat.format(new Date(`${fields.examDate}T00:00Z`)),
    ],
    ["Goal", fields.goal && GOAL_NAMES[fields.goal]],
    [
      "Weekly hours",
      fields.hoursPerWeek === null ? null : `${fields.hoursPerWeek} h`,
    ],
    [
      "Question style",
      fields.questionStyle && QUESTION_STYLE_NAMES[fields.questionStyle],
    ],
    ["Open book", fields.openBook === null ? null : yesNo(fields.openBook)],
    [
      "Formula sheet",
      fields.formulaSheet === null ? null : yesNo(fields.formulaSheet),
    ],
    [
      "Calculator",
      fields.calculator === null ? null : yesNo(fields.calculator),
    ],
    ["Scope confirmed", yesNo(fields.scopeConfirmed)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={value === null ? "text-muted-foreground" : undefined}>
            {value ?? "Not set"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
