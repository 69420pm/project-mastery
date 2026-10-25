"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { answerMapFinding } from "@/features/study/server/actions";
import type { MapFindingItem, MapFindingKind } from "@/features/study/types";

const KIND_NAMES: Record<MapFindingKind, string> = {
  missing_link: "Missing link",
  wrong_link: "Wrong link",
  wrong_description: "Wrong description",
};

/**
 * The Map findings card (#181) under the Today card: the map Findings the
 * tutor filed, with their kind, KCs, reason and quote linked to its page.
 * Open ones have Accept and Dismiss; accepted ones wait for the next Update
 * map. Hidden without any.
 */
export function MapFindingsCard({ findings }: { findings: MapFindingItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (findings.length === 0) return null;

  function answer(id: string, status: "accepted" | "dismissed") {
    startTransition(async () => {
      const result = await answerMapFinding(id, status);
      setError(result.ok ? null : result.message);
    });
  }

  return (
    <Card
      role="region"
      aria-label="Map findings"
      className="w-full max-w-md gap-3 py-4 text-left"
    >
      <CardHeader className="px-4">
        <CardTitle>Map findings</CardTitle>
        <CardDescription>
          Where your tutor found the map disagrees with your Materials.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        <ul className="flex flex-col gap-3">
          {findings.map((finding) => (
            <li key={finding.id} className="flex flex-col gap-1">
              <p>
                <span className="font-medium">{KIND_NAMES[finding.kind]}</span>
                {": "}
                {finding.linkedKc
                  ? `${finding.kc} and ${finding.linkedKc}`
                  : finding.kc}
              </p>
              <p className="text-muted-foreground">{finding.reason}</p>
              <blockquote className="border-l-2 pl-2 italic">
                {finding.quote}
                {finding.source && (
                  <>
                    {" "}
                    <Link
                      href={finding.source.link}
                      className="not-italic underline underline-offset-4"
                    >
                      {finding.source.label}
                    </Link>
                  </>
                )}
              </blockquote>
              {finding.status === "open" ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => answer(finding.id, "accepted")}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => answer(finding.id, "dismissed")}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Accepted: applied at the next Update map.
                </p>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
