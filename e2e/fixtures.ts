import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Playwright fixtures for signed-in tests against the local stack: the
 * production build with AI_PROVIDER=mock and local Supabase (see
 * playwright.config.ts). Import `test` and `expect` from here instead of
 * `@playwright/test`.
 *
 *   test("…", async ({ page, course }) => { await page.goto(course.chatPath); });
 *
 * Using `student` creates a fresh Student through the local auth admin API,
 * signs the browser in as them and deletes them after the test. Using
 * `course` also gives them a Course. Tests that
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

/**
 * The local stack's admin client, bypassing Row Level Security, for checking
 * what the app stored.
 */
export function adminClient() {
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
    model_id: "google/gemini-3.5-flash-lite",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: costUsd,
  });
  if (error) throw new Error(`Seeding AI spend failed: ${error.message}`);
}

/** The Storage bucket of Materials. */
export const MATERIALS_BUCKET = "course-files";

/**
 * The paths of a Student's files in a Course's folder, as uploaded for
 * Materials.
 */
export async function storedFilePaths(
  owner: string,
  courseId: string,
): Promise<string[]> {
  const folder = `${owner}/${courseId}`;
  const { data, error } = await adminClient()
    .storage.from(MATERIALS_BUCKET)
    .list(folder, { limit: 1000 });
  if (error) throw new Error(`Listing files failed: ${error.message}`);
  return data.map((file) => `${folder}/${file.name}`);
}

/** Removes a Student's uploaded files, which deleting them leaves behind. */
async function deleteStudentFiles(student: Student) {
  const bucket = adminClient().storage.from(MATERIALS_BUCKET);
  const { data: courses, error } = await bucket.list(student.id, {
    limit: 1000,
  });
  if (error) throw new Error(`Listing files failed: ${error.message}`);
  for (const course of courses) {
    const paths = await storedFilePaths(student.id, course.name);
    if (paths.length > 0) await bucket.remove(paths);
  }
}

async function deleteStudent(student: Student) {
  await deleteStudentFiles(student);
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

/** A stored Course and the page of a new Chat in it. */
export type SeededCourse = { id: string; name: string; chatPath: string };

/** Stores a Course for a Student. */
export async function seedCourse(
  owner: string,
  name: string,
): Promise<SeededCourse> {
  const { data, error } = await adminClient()
    .from("courses")
    .insert({ owner, name })
    .select("id")
    .single();
  if (error) throw new Error(`Seeding a Course failed: ${error.message}`);
  return { id: data.id, name, chatPath: `/courses/${data.id}/chat` };
}

/**
 * Stores a Chat in a Student's Course with one message from them, as if they
 * had sent it at `at`, for tests that need existing Chats.
 */
export async function seedChat(
  owner: string,
  courseId: string,
  {
    firstMessage,
    title = null,
    at,
  }: {
    firstMessage: string;
    title?: string | null;
    at: Date;
  },
): Promise<string> {
  const id = randomUUID();
  const admin = adminClient();
  const time = at.toISOString();
  const chat = await admin.from("chats").insert({
    id,
    owner,
    course_id: courseId,
    title,
    created_at: time,
    last_message_at: time,
  });
  if (chat.error)
    throw new Error(`Seeding a Chat failed: ${chat.error.message}`);
  const message = await admin.from("chat_messages").insert({
    chat_id: id,
    role: "user",
    parts: [{ type: "text", text: firstMessage }],
    created_at: time,
  });
  if (message.error)
    throw new Error(`Seeding a message failed: ${message.error.message}`);
  return id;
}

/**
 * Stores a Material in a Student's Course with its file, as if they had
 * uploaded `file`, for tests that need existing Materials.
 */
export async function seedMaterial(
  owner: string,
  courseId: string,
  { name, file, mediaType }: { name: string; file: string; mediaType: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  const storagePath = `${owner}/${courseId}/${id}`;
  const body = await readFile(file);
  const admin = adminClient();
  const upload = await admin.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, body, { contentType: mediaType });
  if (upload.error)
    throw new Error(`Seeding a file failed: ${upload.error.message}`);
  const material = await admin.from("materials").insert({
    id,
    owner,
    course_id: courseId,
    name,
    media_type: mediaType,
    size_bytes: body.byteLength,
    storage_path: storagePath,
  });
  if (material.error)
    throw new Error(`Seeding a Material failed: ${material.error.message}`);
  return { id };
}

export const test = base.extend<{
  student: Student;
  /** A Course of the Student's, named "Calculus". */
  course: SeededCourse;
}>({
  course: async ({ student }, provide) => {
    await provide(await seedCourse(student.id, "Calculus"));
  },
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

/**
 * The sidebar's Chat list inside a Course, or its Course list on `/courses`
 * (`list: "Courses"`). On a phone the sidebar is a slide-over that opens
 * from the menu button first.
 */
export async function openSidebar(
  page: Page,
  list: "Chats" | "Courses" = "Chats",
) {
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  if (test.info().project.name === "mobile") await toggle.click();
  return page.getByRole("navigation", { name: list });
}

export { expect } from "@playwright/test";
