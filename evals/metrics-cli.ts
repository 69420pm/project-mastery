/**
 * Computes session metrics per Chat and upserts them as Langfuse scores on
 * the session whose id is the Chat's id:
 *
 *   pnpm -s metrics [--since YYYY-MM-DD]   # default: 7 days ago
 *
 * Takes the Chats with a message since the date and with real-model
 * replies, reading every Student's Chats with the admin client, and makes
 * no model calls.
 */
// Must come first: lets evals import modules that use Next.js.
import "./next-aliases";
import { parseArgs } from "node:util";
import { costText } from "@/lib/ai/cost";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { isLangfuseConfigured } from "@/lib/tracing/env";
import { createMetricsLangfuse } from "./langfuse";
import {
  chatMetrics,
  scoreSessions,
  type MetricsChat,
  type MetricsMessage,
} from "./metrics";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
/** Ids per `in` filter, to keep the request URL short. */
const ID_BATCH = 100;

function sinceDate(value: string | undefined): Date {
  if (value === undefined) {
    const start = new Date(Date.now() - 7 * DAY_MS);
    return new Date(start.toISOString().slice(0, 10));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`--since takes a date as YYYY-MM-DD, not "${value}".`);
  }
  return new Date(value);
}

/** Every row of a query, page by page past PostgREST's row limit. */
async function allRows<Row>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Loading Chats failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += ID_BATCH) {
    result.push(items.slice(start, start + ID_BATCH));
  }
  return result;
}

async function loadChats(
  supabase: AdminSupabase,
  since: Date,
): Promise<MetricsChat[]> {
  const recent = await allRows((from, to) =>
    supabase
      .from("chat_messages")
      .select("chat_id")
      .gte("created_at", since.toISOString())
      .order("id")
      .range(from, to),
  );
  const chatIds = [...new Set(recent.map((row) => row.chat_id))];

  const chats: MetricsChat[] = [];
  for (const ids of batches(chatIds)) {
    const [chatRows, messageRows] = await Promise.all([
      allRows((from, to) =>
        supabase
          .from("chats")
          .select("id, created_at")
          .in("id", ids)
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) =>
        supabase
          .from("chat_messages")
          .select("id, chat_id, role, parts, created_at")
          .in("chat_id", ids)
          .order("created_at")
          .order("id")
          .range(from, to),
      ),
    ]);
    const replyIds = messageRows
      .filter((row) => row.role === "assistant")
      .map((row) => row.id);
    const costs = new Map<string, number>();
    for (const replies of batches(replyIds)) {
      const usage = await allRows((from, to) =>
        supabase
          .from("ai_usage")
          .select("id, reply_id, cost_usd")
          .in("reply_id", replies)
          .order("id")
          .range(from, to),
      );
      for (const row of usage) {
        if (row.reply_id === null) continue;
        costs.set(
          row.reply_id,
          (costs.get(row.reply_id) ?? 0) + Number(row.cost_usd),
        );
      }
    }
    for (const chat of chatRows) {
      const messages: MetricsMessage[] = messageRows
        .filter((row) => row.chat_id === chat.id)
        .map((row) => ({
          id: row.id,
          role: row.role,
          parts: row.parts,
          createdAt: row.created_at,
        }));
      chats.push({
        id: chat.id,
        createdAt: chat.created_at,
        messages,
        replyCostUsd: costs,
      });
    }
  }
  return chats;
}

const share = (value: number | undefined) =>
  value === undefined ? "-" : `${Math.round(value * 100)}%`;

async function main() {
  const { values } = parseArgs({ options: { since: { type: "string" } } });
  const since = sinceDate(values.since);
  if (!isLangfuseConfigured()) {
    console.info(
      "Langfuse keys not set: the metrics are written as Langfuse scores (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY).",
    );
    process.exitCode = 1;
    return;
  }

  const chats = await loadChats(createAdminClient(), since);
  const { scored, skipped } = await scoreSessions(
    createMetricsLangfuse(),
    chats,
  );

  console.info(
    `Scored ${scored.length} Chats with messages since ${since.toISOString().slice(0, 10)}; skipped ${skipped} mock-provider Chats.`,
  );
  for (const chat of scored) {
    const metrics = chatMetrics(chat);
    const cost =
      metrics.cost_per_active_hour === undefined
        ? "-"
        : `${costText(metrics.cost_per_active_hour)}/h`;
    console.info(
      [
        chat.id,
        `student words ${share(metrics.student_word_share)}`,
        `questions ${share(metrics.ai_question_share)}`,
        `active ${metrics.active_minutes.toFixed(1)} min`,
        cost,
      ].join("  "),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
