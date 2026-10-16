import "server-only";
import { costUsd, type TokenUsage } from "@/lib/ai/cost";
import type { AiTask } from "@/lib/ai/models";
import { isAdminClient } from "@/lib/supabase/admin-brand";
import type {
  AdminSupabase,
  SessionSupabase,
  Supabase,
} from "@/lib/supabase/types";

/**
 * Records and sums AI usage. With the Student's session client, Row Level
 * Security applies: a Student adds and reads only their own records and can
 * never change or delete them. Workflows have no session and pass the admin
 * client with an explicit `studentId`, which then scopes every query.
 */

/** Whose usage to record or sum when the client has no Student session. */
export type StudentScope = {
  /**
   * The Student the usage belongs to. Required with the admin client, which
   * bypasses Row Level Security; omit it with the Student's session client.
   */
  studentId?: string;
};

/** The scope the admin client needs: always an explicit Student. */
export type AdminStudentScope = Required<StudentScope>;

/**
 * Refuses the admin client without a Student id, which would record usage
 * for no one or sum every Student's spend. The overloads catch this at
 * compile time; this catches a client whose type was widened.
 */
export function assertStudentScope(
  supabase: Supabase,
  { studentId }: StudentScope,
) {
  if (studentId === undefined && isAdminClient(supabase)) {
    throw new Error(
      "AI usage with the admin client needs a Student id: it bypasses Row Level Security.",
    );
  }
}

/** One AI call made for the Student, as recorded. */
export type AiUsageRecord = {
  task: AiTask;
  /** The model that answered, as priced in MODEL_PRICES. */
  modelId: string;
  usage: TokenUsage;
  /** True when `usage` is an estimate, as for an aborted call. */
  estimated?: boolean;
  /** The Chat the call was made for, if any. */
  chatId?: string;
  /** The id of the Chat reply the call produced, if any. */
  replyId?: string;
};

/**
 * Records one AI call for the signed-in Student, or for `studentId` when
 * given, priced in US dollars from the price table (ADR 0006). Throws when
 * the model has no price, the insert fails, or the admin client comes
 * without a Student id.
 */
export async function recordAiUsage(
  supabase: AdminSupabase,
  record: AiUsageRecord,
  scope: AdminStudentScope,
): Promise<void>;
export async function recordAiUsage(
  supabase: SessionSupabase,
  record: AiUsageRecord,
  scope?: StudentScope,
): Promise<void>;
export async function recordAiUsage(
  supabase: Supabase,
  { task, modelId, usage, estimated = false, chatId, replyId }: AiUsageRecord,
  { studentId }: StudentScope = {},
): Promise<void> {
  assertStudentScope(supabase, { studentId });
  const { error } = await supabase.from("ai_usage").insert({
    // Without it, the column defaults to the session's Student (auth.uid()).
    ...(studentId === undefined ? {} : { owner: studentId }),
    task,
    model_id: modelId,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: costUsd(modelId, usage),
    estimated,
    chat_id: chatId ?? null,
    reply_id: replyId ?? null,
  });
  if (error) throw new Error(`Recording AI usage failed: ${error.message}`);
}

/**
 * The signed-in Student's AI spend in US dollars since `since`, or that of
 * `studentId` when given. Throws for the admin client without a Student id.
 */
export async function spentSinceUsd(
  supabase: Supabase,
  since: Date,
  { studentId }: StudentScope = {},
): Promise<number> {
  assertStudentScope(supabase, { studentId });
  let query = supabase
    .from("ai_usage")
    .select("cost_usd")
    .gte("created_at", since.toISOString());
  if (studentId !== undefined) query = query.eq("owner", studentId);
  const { data, error } = await query;
  if (error) throw new Error(`Loading AI usage failed: ${error.message}`);
  return data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
}
