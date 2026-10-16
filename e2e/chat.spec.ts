import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { modelName } from "../src/lib/ai/model-name";
import { adminClient, expect, seedChat, test } from "./fixtures";

// The mock AI (AI_PROVIDER=mock) quotes the message and ends with this.
const REPLY_END = "it never calls a real model.";

function messageInput(page: Page) {
  return page.getByRole("textbox", { name: "Message" });
}

/** The address of a stored Chat in the Course. */
function chatUrlIn(courseId: string) {
  return new RegExp(`/courses/${courseId}/chat/[0-9a-f-]{36}$`);
}

async function sendMessage(page: Page, text: string) {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
}

/** A Chat's stored AI replies, in order. */
async function storedReplies(chatId: string) {
  const { data } = await adminClient()
    .from("chat_messages")
    .select("id, parts, stopped")
    .eq("chat_id", chatId)
    .eq("role", "assistant")
    .order("created_at");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    stopped: row.stopped as boolean,
    text: (row.parts as Array<{ type: string; text?: string }>)
      .map((part) => part.text ?? "")
      .join(""),
  }));
}

test.describe("signed in", () => {
  // Every test here runs as a fresh, signed-in Student.
  test.beforeEach(({ student }) => {
    test
      .info()
      .annotations.push({ type: "student", description: student.email });
  });

  test("the empty state tells a Course without a map to build one", async ({
    page,
    course,
  }) => {
    await page.goto(course.chatPath);
    await expect(
      page.getByText("Build your Knowledge map to start studying"),
    ).toBeVisible();
  });

  test("a first message creates a Chat, streams the reply and keeps the history", async ({
    page,
    course,
  }) => {
    await page.goto(course.chatPath);
    await expect(
      page.getByRole("heading", { name: "Ready to study?" }),
    ).toBeVisible();

    await sendMessage(page, "What is $x^2$ for x = 3?");

    const log = page.getByRole("log");
    await expect(log.getByText("What is $x^2$ for x = 3?")).toBeVisible();
    // The reply streams in: its beginning shows before its end.
    await expect(log.getByText(/Mock reply to/)).toBeVisible();
    await expect(page).toHaveURL(chatUrlIn(course.id));
    await expect(log.getByText(REPLY_END, { exact: false })).toBeVisible();
    // The quoted message renders its math with KaTeX.
    await expect(log.locator(".katex").first()).toBeVisible();
    const chatUrl = page.url();

    // The input refuses a submit until the reply has fully settled.
    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
    await sendMessage(page, "And for x = 4?");
    await expect(
      log.getByText(/Mock reply to "And for x = 4\?"/),
    ).toBeVisible();
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(2);

    // The reply is stored as its stream ends, after its last text shows.
    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
    await page.reload();

    expect(page.url()).toBe(chatUrl);
    await expect(log.getByTestId("message-text")).toHaveText([
      "What is $x^2$ for x = 3?",
      /^Mock reply to "What is/,
      "And for x = 4?",
      /^Mock reply to "And for x = 4\?"/,
    ]);
  });

  test("a message over 10,000 characters is refused in the input", async ({
    page,
    course,
  }) => {
    await page.goto(course.chatPath);

    await sendMessage(page, "x".repeat(10_001));

    await expect(messageInput(page)).toHaveAccessibleDescription(
      "Your message is too long. Keep it under 10,000 characters.",
    );
    await expect(messageInput(page)).toHaveValue("x".repeat(10_001));
    await expect(page).toHaveURL(course.chatPath);
  });

  test("the model picker applies a choice from the next message on and the Chat remembers it", async ({
    page,
    course,
  }) => {
    await page.goto(course.chatPath);
    const picker = page.getByRole("combobox", { name: "Model" });
    // A new Chat starts on Balanced.
    await expect(picker).toHaveText("Balanced");

    await sendMessage(page, "First question");
    const log = page.getByRole("log");
    await expect(log.getByText(REPLY_END, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(chatUrlIn(course.id));
    const chatId = page.url().split("/").at(-1);

    // Each choice shows its model's name under its label.
    await picker.click();
    await expect(page.getByRole("option")).toHaveText([
      /^Fast\S/,
      /^Balanced\S/,
      /^Thorough\S/,
    ]);
    const thorough = page.getByRole("option", { name: /^Thorough/ });
    const thoroughModel = await thorough
      .getByTestId("model-name")
      .textContent();
    expect(thoroughModel).toBeTruthy();
    await thorough.click();
    await expect(picker).toHaveText("Thorough");

    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
    await sendMessage(page, "Second question");
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(2);

    // Only the reply after the change used the chosen model. The server
    // saves a reply once its stream ends, so wait for the row to land.
    const replyModels = async () => {
      const { data } = await adminClient()
        .from("chat_messages")
        .select("model_id")
        .eq("chat_id", chatId!)
        .eq("role", "assistant")
        .order("created_at");
      return (data ?? []).map((row) => row.model_id as string);
    };
    await expect.poll(async () => (await replyModels()).length).toBe(2);
    const [first, second] = await replyModels();
    expect(modelName(second!)).toBe(thoroughModel);
    expect(first).not.toBe(second);

    await page.reload();
    await expect(picker).toHaveText("Thorough");

    await page.goto(course.chatPath);
    await expect(picker).toHaveText("Balanced");
  });

  test("Stop ends a reply early and the stopped reply stays after a reload", async ({
    page,
    course,
  }) => {
    await page.goto(course.chatPath);
    await sendMessage(page, "Explain limits");
    const log = page.getByRole("log");
    // Stop only once the echoed prompt is on screen, so the partial reply
    // always holds it. A bare "Mock reply to" can be cut mid-prompt.
    await expect(log.getByText(/Mock reply to "Explain limits"/)).toBeVisible();

    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
    await expect(log.getByText("Stopped", { exact: true })).toBeVisible();
    // The server stores the partial reply once the aborted stream ends.
    const chatId = page.url().split("/").at(-1)!;
    await expect.poll(async () => (await storedReplies(chatId)).length).toBe(1);
    const [reply] = await storedReplies(chatId);
    expect(reply).toMatchObject({ stopped: true });
    expect(reply!.text).toMatch(/^Mock reply to "Explain limits"/);
    expect(reply!.text).not.toContain(REPLY_END);

    await page.reload();

    await expect(log.getByTestId("message-text")).toHaveText([
      "Explain limits",
      reply!.text.trim(),
    ]);
    await expect(log.getByText("Stopped", { exact: true })).toBeVisible();
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(0);
  });

  test("Regenerate replaces the last reply, and Copy copies a message", async ({
    page,
    context,
    course,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(course.chatPath);
    await sendMessage(page, "What is a group?");
    const log = page.getByRole("log");
    await expect(log.getByText(REPLY_END, { exact: false })).toBeVisible();
    const chatId = page.url().split("/").at(-1)!;
    await expect.poll(async () => (await storedReplies(chatId)).length).toBe(1);
    const [first] = await storedReplies(chatId);

    await page.getByRole("button", { name: "Regenerate" }).click();

    // The old reply is gone while the new one streams in.
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(0);
    await expect(log.getByText(REPLY_END, { exact: false })).toHaveCount(1);
    // Wait for the new reply to be stored, not just for the old one to go.
    await expect
      .poll(async () => {
        const replies = await storedReplies(chatId);
        return replies.length === 1 && replies[0]!.id !== first!.id;
      })
      .toBe(true);
    await page.reload();
    await expect(log.getByTestId("message-text")).toHaveText([
      "What is a group?",
      /^Mock reply to "What is a group\?"/,
    ]);

    await page.getByRole("button", { name: "Copy" }).first().click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "What is a group?",
    );
  });

  test("a reply shows its tool calls as step cards that expand, and its context", async ({
    page,
    student,
    course,
  }) => {
    // The mock AI calls no tools, so the reply is stored as the AI would.
    const chatId = await seedChat(student.id, course.id, {
      firstMessage: "Teach me limits",
      at: new Date(),
    });
    const { error } = await adminClient()
      .from("chat_messages")
      .insert({
        chat_id: chatId,
        role: "assistant",
        model_id: "mock",
        parts: [
          { type: "step-start" },
          {
            type: "tool-readKcs",
            toolCallId: "call-1",
            state: "output-available",
            input: { kcIds: ["kc-1"] },
            output: {
              kcs: [
                {
                  id: "kc-1",
                  name: "Limits",
                  type: "concept",
                  description: "What a function approaches.",
                  sources: [],
                },
              ],
            },
          },
          { type: "step-start" },
          { type: "text", text: "Let's start with limits." },
        ],
        tutor_context: {
          today: "2026-10-16",
          examDate: "2026-12-03",
          hasMap: true,
          phase: "build",
          share: null,
          leftOutCount: null,
          goal: "pass",
          memory: "",
          mapPath: `/courses/${course.id}/map`,
          dueReviews: { kcs: [], more: 0 },
          candidates: [
            {
              bigIdea: "Calculus",
              kcs: [
                {
                  id: "kc-2",
                  name: "Continuity",
                  type: "concept",
                  anchors: [],
                },
              ],
            },
          ],
        },
      });
    expect(error).toBeNull();

    await page.goto(`${course.chatPath}/${chatId}`);
    const card = page.getByRole("button", { name: "Read 1 KC: Limits" });
    await expect(card).toBeVisible();
    await expect(page.getByText("Let's start with limits.")).toBeVisible();
    await expect(page.getByText("What a function approaches.")).toBeHidden();

    await card.click();
    await expect(page.getByText("What a function approaches.")).toBeVisible();

    await page.getByRole("button", { name: "Context" }).click();
    const sheet = page.getByRole("dialog", { name: "Context" });
    await expect(
      sheet.getByRole("region", { name: "Candidates" }).getByText("Continuity"),
    ).toBeVisible();
  });

  test("an unknown Chat or Course shows not-found", async ({
    page,
    course,
  }) => {
    for (const path of [
      `${course.chatPath}/${randomUUID()}`,
      `/courses/${randomUUID()}/chat`,
    ]) {
      const response = await page.goto(path);

      expect(response?.status()).toBe(404);
      await expect(
        page.getByText("This page could not be found."),
      ).toBeVisible();
    }
  });
});

test("signed out, a Chat page redirects to sign-in and returns there afterwards", async ({
  page,
  context,
  student,
  course,
}) => {
  await context.clearCookies();

  await page.goto(course.chatPath);
  await expect(page).toHaveURL(
    `/login?next=${encodeURIComponent(course.chatPath)}`,
  );

  await page.getByLabel("Email").fill(student.email);
  await page.getByLabel("Password").fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).last().click();

  await expect(page).toHaveURL(course.chatPath);
  await expect(messageInput(page)).toBeVisible();
});
