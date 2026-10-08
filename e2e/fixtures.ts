import { randomUUID } from "node:crypto";
import { test as base, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Playwright fixtures for signed-in tests against the local stack: the
 * production build with AI_PROVIDER=mock and local Supabase (see
 * playwright.config.ts). Import `test` and `expect` from here instead of
 * `@playwright/test`.
 *
 *   test("…", async ({ page, student }) => { await page.goto("/chat"); });
 *
 * Using `student` creates a fresh Student through the local auth admin API,
 * signs the browser in as them and deletes them after the test. Tests that
 * use it are skipped against a deployment (PLAYWRIGHT_BASE_URL), which has
 * neither the local admin API nor the mock AI.
 */

export type Student = {
  id: string;
  email: string;
  displayName: string;
  /** For tests that sign in through the form. */
  password: string;
};

/** Whether the tests run against a deployment instead of the local stack. */
export const isDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

const PASSWORD = "e2e-password-123";

function localSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error(
      "Signed-in tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY of the local stack (in .env.local, from `pnpm db:status`).",
    );
  }
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL points at ${hostname}: signed-in tests only create users in the local stack.`,
    );
  }
  return { url, publishableKey, secretKey };
}

function adminClient() {
  const { url, secretKey } = localSupabaseEnv();
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Creates a confirmed Student with a unique email. */
async function createStudent(): Promise<Student> {
  const email = `student-${randomUUID()}@example.com`;
  const displayName = "Test Student";
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error)
    throw new Error(`Creating a test Student failed: ${error.message}`);
  return { id: data.user.id, email, displayName, password: PASSWORD };
}

/**
 * Records AI spend for a Student today, as one usage record of `costUsd`
 * dollars, to bring them near or to the Daily limit (AI_DAILY_LIMIT_USD in
 * playwright.config.ts). The records go with the Student.
 */
export async function seedAiSpend(student: Student, costUsd: number) {
  const { error } = await adminClient().from("ai_usage").insert({
    owner: student.id,
    task: "chat",
    model_id: "google/gemini-2.5-flash",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: costUsd,
  });
  if (error) throw new Error(`Seeding AI spend failed: ${error.message}`);
}

async function deleteStudent(student: Student) {
  const { error } = await adminClient().auth.admin.deleteUser(student.id);
  if (error)
    throw new Error(`Deleting a test Student failed: ${error.message}`);
}

/**
 * Signs in with the same cookie client the app uses, and hands its session
 * cookies to the browser, so the first page already loads signed in.
 */
async function signIn(
  context: BrowserContext,
  student: Student,
  baseURL: string,
) {
  const { url, publishableKey } = localSupabaseEnv();
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: student.email,
    password: PASSWORD,
  });
  if (error)
    throw new Error(`Signing in a test Student failed: ${error.message}`);
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: baseURL })),
  );
}

export const test = base.extend<{ student: Student }>({
  student: async ({ context, baseURL }, provide, testInfo) => {
    testInfo.skip(
      isDeployment,
      "Signed-in tests run only against the local stack.",
    );
    const student = await createStudent();
    await signIn(context, student, baseURL ?? "http://localhost:3000");
    await provide(student);
    await deleteStudent(student);
  },
});

export { expect } from "@playwright/test";
