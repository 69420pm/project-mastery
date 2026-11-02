import { randomUUID } from "node:crypto";
import { respondInChat } from "@/features/chat/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { insertRows, seedGoldCourse } from "./gold-course";
import { result, type SmokeCheck } from "./smoke-check";

/** Case, whitespace and Markdown emphasis as the tool's quote check ignores. */
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s*_]+/g, " ")
    .trim();

/**
 * Seeds the gold course (whose chunks hold their embeddings) and reverses
 * its first Prerequisite, with the two KCs' sources cut to the course's
 * first chunk, so the AI must search for the pages that show the link. In
 * a Chat, the Student disputes that link: the AI must find a chunk with
 * `searchMaterials` and file a `wrong_link` Finding with `flagMap`, whose
 * quote is in its chunk.
 */
export const mapFindingsSmoke: SmokeCheck = {
  name: "map-findings",
  usage:
    "pnpm smoke map-findings (the gold course with a reversed Prerequisite; the Student disputes it in a Chat)",
  // One query embedding, one reply of up to 5 steps as one row and a title.
  maxCalls: 6,
  async run({ supabase, studentId }) {
    const gold = await seedGoldCourse(supabase, studentId);
    const { courseId } = gold;
    const owned = { owner: studentId, course_id: courseId };
    const link = gold.prerequisites[0];
    if (!link) throw new Error("The gold course has no Prerequisite.");
    const name = (kcId: string) =>
      gold.kcs.find((kc) => kc.id === kcId)?.name ?? kcId;

    // Reverse the link: `to` now looks like a Prerequisite of `from`.
    const planted = { from_kc: link.to, to_kc: link.from };
    const removed = await supabase
      .from("prerequisite_links")
      .delete()
      .eq("course_id", courseId)
      .eq("from_kc", link.from)
      .eq("to_kc", link.to);
    if (removed.error) throw new Error(removed.error.message);
    await insertRows(supabase, "prerequisite_links", [
      { ...owned, ...planted },
    ]);

    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("id, markdown")
      .eq("course_id", courseId)
      .order("position");
    if (chunksError) throw new Error(chunksError.message);
    const cut = await supabase
      .from("kc_sources")
      .delete()
      .eq("course_id", courseId)
      .in("kc_id", [link.from, link.to]);
    if (cut.error) throw new Error(cut.error.message);
    await insertRows(
      supabase,
      "kc_sources",
      [link.from, link.to].map((kcId) => ({
        ...owned,
        kc_id: kcId,
        chunk_id: chunks[0]!.id,
      })),
    );

    const dispute = `On my Course map, '${name(link.to)}' is listed as a prerequisite of '${name(link.from)}'. I think it's the other way round. Can you search the course pages, and if they show that link is wrong, file a Finding on my map so I can accept it?`;

    // One reply through the real Chat handler, as the Student.
    const client = await signInAsUser(supabase, studentId);
    console.info(`Student: ${dispute}`);
    const response = await respondInChat({
      request: new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          chatId: randomUUID(),
          courseId,
          message: {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text: dispute }],
          },
        }),
      }),
      supabase: client,
      userId: studentId,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${body}`);
    const parts = body
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice("data: ".length)));
    const names = new Map<string, string>();
    let searched = 0;
    let filed = 0;
    for (const part of parts) {
      if (part.type === "tool-input-available") {
        names.set(part.toolCallId, part.toolName);
        console.info(`  ${part.toolName} ${JSON.stringify(part.input)}`);
      }
      if (part.type === "tool-output-available") {
        const tool = names.get(part.toolCallId);
        if (tool === "searchMaterials") {
          searched += Array.isArray(part.output?.chunks)
            ? part.output.chunks.length
            : 0;
        }
        if (tool === "flagMap" && typeof part.output?.findingId === "string") {
          filed += 1;
        }
      }
      if (part.type === "tool-output-error" || part.type === "error") {
        console.info(`  ${part.type}: ${part.errorText}`);
      }
    }
    console.info(
      `AI: ${parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join("")}`,
    );

    const { data: findings, error: findingsError } = await supabase
      .from("map_findings")
      .select("id, kind, kc_id, linked_kc_id, chunk_id, quote, status")
      .eq("course_id", courseId);
    if (findingsError) throw new Error(findingsError.message);
    const wrong = findings.filter(
      ({ kind, kc_id, linked_kc_id }) =>
        kind === "wrong_link" &&
        [kc_id, linked_kc_id].includes(link.from) &&
        [kc_id, linked_kc_id].includes(link.to),
    );
    const finding = wrong[0];
    const chunk = chunks.find((c) => c.id === finding?.chunk_id);
    const quoted =
      finding !== undefined &&
      chunk !== undefined &&
      squash(chunk.markdown).includes(squash(finding.quote));

    return [
      result(
        "searchMaterials returned a chunk",
        searched > 0,
        `${searched} chunks`,
      ),
      result(
        "flagMap filed a wrong_link Finding on the disputed KCs",
        filed > 0 && finding !== undefined,
        `${filed} filed, ${findings.length} stored, ${wrong.length} on the link`,
      ),
      result(
        "the Finding's quote is in its chunk",
        quoted,
        finding?.quote.slice(0, 80),
      ),
    ];
  },
};
