import { adminClient, expect, test } from "./fixtures";

/**
 * The Course map draws the Topic tree as nested boxes: a parent Topic with
 * KCs of its own has a card inside its box beside its children's.
 */

/**
 * Stores a built map whose Topic "Propulsion" holds the KC "Momentum" and
 * the child Topic "Thrust", which holds "Thrust equation".
 */
async function seedTree(owner: string, courseId: string): Promise<void> {
  const admin = adminClient();
  const owned = { owner, course_id: courseId };
  const check = ({ error }: { error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
  };
  const parent = crypto.randomUUID();
  const child = crypto.randomUUID();
  const kcs = [
    { id: crypto.randomUUID(), name: "Momentum", topic: parent },
    { id: crypto.randomUUID(), name: "Thrust equation", topic: child },
  ];
  check(
    await admin.from("kcs").insert(
      kcs.map(({ id, name }, position) => ({
        ...owned,
        id,
        name,
        description: `${name}.`,
        origin: "content" as const,
        position,
      })),
    ),
  );
  check(
    await admin.from("topics").insert([
      {
        ...owned,
        id: parent,
        parent_id: null,
        name: "Propulsion",
        central_question: "What moves a rocket?",
        chapter_ids: [crypto.randomUUID()],
        position: 0,
      },
      {
        ...owned,
        id: child,
        parent_id: parent,
        name: "Thrust",
        central_question: "Where does thrust come from?",
        chapter_ids: [crypto.randomUUID()],
        position: 1,
      },
    ]),
  );
  check(
    await admin.from("topic_kcs").insert(
      kcs.map(({ id, topic }) => ({
        topic_id: topic,
        kc_id: id,
        owner,
        position: 0,
      })),
    ),
  );
  check(
    await admin.from("knowledge_map_builds").insert({
      ...owned,
      status: "built",
      finished_at: new Date().toISOString(),
    }),
  );
}

test("the Course map nests a Topic in its parent, which opens with its own KCs and then the child", async ({
  page,
  student,
  course,
}) => {
  await seedTree(student.id, course.id);
  await page.goto(`/courses/${course.id}/map`);

  // React Flow renders the nodes side by side, so nesting shows in where
  // the cards sit: both inside the box.
  const graph = page.getByRole("application", { name: "Course map graph" });
  const box = graph.getByRole("group", { name: "Propulsion" });
  const own = graph.getByRole("link", { name: "Propulsion" });
  const child = graph.getByRole("link", { name: "Thrust" });
  await expect(child).toBeVisible();
  const outer = (await box.boundingBox())!;
  for (const card of [own, child]) {
    const inner = (await card.boundingBox())!;
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.x + inner.width).toBeLessThan(outer.x + outer.width);
    expect(inner.y + inner.height).toBeLessThan(outer.y + outer.height);
  }
  await own.click();

  await expect(
    page.getByRole("heading", { name: "Propulsion", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "KCs" }).getByText("Momentum"),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Topics inside" })
    .getByRole("link", { name: "Thrust" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Thrust", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Part of Propulsion")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "KCs" }).getByText("Thrust equation"),
  ).toBeVisible();
});
