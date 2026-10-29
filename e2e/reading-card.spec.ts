import path from "node:path";
import { adminClient, expect, seedMaterial, test } from "./fixtures";

/**
 * Guided reading with the mock AI (AI_PROVIDER=mock): "Read with me" makes
 * it call `showReading` on the first Reading section the instructions list,
 * and Done sends "Done reading." with the section's id.
 */

const PDF = path.join(__dirname, "files", "lecture-notes.pdf");

/**
 * Stores a one-KC Topic whose KC cites a chunk on page 1 of a parsed PDF
 * Material in the Course, so the Topic reads as one Reading section.
 */
async function seedReading(owner: string, courseId: string): Promise<void> {
  const admin = adminClient();
  const owned = { owner, course_id: courseId };
  const insert = async (table: string, row: object) => {
    const { data, error } = await admin
      .from(table as "kcs")
      .insert(row as never)
      .select("id")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as { id: string }).id;
  };
  const bigIdea = await insert("big_ideas", {
    ...owned,
    name: "Thrust",
    description: "Thrust.",
    position: 0,
  });
  const kc = await insert("kcs", {
    ...owned,
    big_idea_id: bigIdea,
    name: "Thrust equation",
    description: "Thrust is mass flow times the change in velocity.",
    type: "procedure",
    origin: "content",
    position: 0,
  });
  const topic = await insert("topics", {
    ...owned,
    big_idea_id: bigIdea,
    name: "Thrust basics",
    central_question: "What makes a rocket accelerate?",
    position: 0,
  });
  const link = await admin
    .from("topic_kcs")
    .insert({ topic_id: topic, kc_id: kc, owner, position: 0 });
  if (link.error) throw new Error(link.error.message);
  const material = await seedMaterial(owner, courseId, {
    name: "Lecture notes",
    file: PDF,
    mediaType: "application/pdf",
  });
  const parsed = await admin
    .from("materials")
    .update({ parse_status: "parsed" })
    .eq("id", material.id);
  if (parsed.error) throw new Error(parsed.error.message);
  const chunk = await insert("chunks", {
    ...owned,
    material_id: material.id,
    position: 0,
    page_from: 1,
    page_to: 1,
    label: "content",
    markdown: "Thrust is mass flow times the change in velocity.",
  });
  const source = await admin
    .from("kc_sources")
    .insert({ ...owned, kc_id: kc, chunk_id: chunk });
  if (source.error) throw new Error(source.error.message);
}

test("the AI opens a reading, the pane shows its page, and Done marks the card read", async ({
  page,
  student,
  course,
}) => {
  await seedReading(student.id, course.id);
  await page.goto(course.chatPath);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Read with me");
  await message.press("Enter");

  // The streaming reply opened the pane on the section's page: beside the
  // conversation when wide, in a Sheet over it on a phone.
  const pane = page
    .getByRole("complementary", { name: "Source" })
    .or(page.getByRole("region", { name: "Source" }));
  await expect(pane.getByText("Page 1 of 1")).toBeVisible();

  await pane.getByRole("button", { name: "Done" }).click();

  await expect(pane.getByText("Read", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Close source" }).click();
  const card = page.getByRole("region", { name: "Reading" });
  await expect(card).toHaveAttribute("data-reading-state", "done");
  await expect(card).toContainText("Lecture notes, p. 1");
  await expect(card).toContainText("Mock purpose: what makes thrust?");
  await expect(
    page.getByText('Mock reply to "[Done reading section', { exact: false }),
  ).toBeVisible();
  const { data: stored } = await adminClient()
    .from("chat_messages")
    .select("parts, chats!inner(course_id)")
    .eq("chats.course_id", course.id)
    .not("reading_section_id", "is", null);
  expect(stored?.map((message) => message.parts)).toEqual([
    [{ type: "text", text: "Done reading." }],
  ]);

  // Once the reply has ended and is stored, a reload keeps the card read,
  // and a stored reading does not open the pane on its own.
  await expect(
    page.getByText("it never calls a real model.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Reading" })).toHaveAttribute(
    "data-reading-state",
    "done",
  );
  await expect(pane).toBeHidden();
});
