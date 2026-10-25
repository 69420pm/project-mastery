import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { respondInChat } from "@/features/chat/server";
import { meteredEmbed } from "@/features/usage/server";
import { signInAsUser } from "@/lib/supabase/admin";
import { insertGoldMap, insertGoldTopics } from "./gold-map";
import { CHUNKS_FILE, fixtureSchema, insertMaterial } from "./map";
import { result, type SmokeCheck } from "./smoke-check";
import { build } from "./topics";

/**
 * The planted error: the gold map has KC04 (General thrust equation) as a
 * Prerequisite of KC05 (Perfectly expanded nozzle simplification), as the
 * Material's 7.1 explains it. The smoke map has the link reversed.
 */
const DISPUTE =
  "On my Course map, the 'Perfectly expanded nozzle simplification' KC is listed as a prerequisite of the 'General thrust equation' KC. I think it's the other way round: the pages first give the full equation and then simplify it. Can you search the course pages, and if they show that link is wrong, file a Finding on my map so I can accept it?";

/** Case, whitespace and Markdown emphasis as the tool's quote check ignores. */
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s*_]+/g, " ")
    .trim();

/**
 * Stores the jet-engines gold map with its Topics, the real chunks embedded
 * and the KC04 to KC05 Prerequisite reversed. In a Chat, the Student
 * disputes that link: the AI must find a chunk with `searchMaterials` and
 * file a `wrong_link` Finding with `flagMap`, whose quote is in its chunk.
 * The Student accepts it, the real Update map (no new chunks) runs, and the
 * wrong link must be gone and the Finding `applied`.
 */
export const mapFindingsSmoke: SmokeCheck = {
  name: "map-findings",
  usage:
    "pnpm smoke map-findings (the gold map with a reversed Prerequisite and embedded chunks; the Student disputes it in a Chat, accepts the Finding, Update map applies it)",
  // Embedding the chunks (2 batches), one query, one reply of up to 5 steps
  // as one row, a title, the correction call and the build's other calls.
  maxCalls: 20,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const courseId = course.id;
    const owned = { owner: studentId, course_id: courseId };
    const gold = await insertGoldMap(supabase, studentId, courseId);
    const { id } = gold;

    // Reverse the link: KC05 builds on KC04 in the gold, not the other way.
    const planted = { from_kc: id("KC05"), to_kc: id("KC04") };
    const removed = await supabase
      .from("prerequisite_links")
      .delete()
      .eq("course_id", courseId)
      .eq("from_kc", id("KC04"))
      .eq("to_kc", id("KC05"));
    if (removed.error) throw new Error(removed.error.message);
    const added = await supabase
      .from("prerequisite_links")
      .insert({ ...owned, ...planted, extraction_confidence: 0.9 });
    if (added.error) throw new Error(added.error.message);

    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(CHUNKS_FILE, "utf8")),
    );
    const idAt = await insertMaterial(supabase, {
      studentId,
      courseId,
      name: "jet-engines.pdf",
      chunks: fixture,
    });
    const chunkIds = [...idAt.values()];
    for (const table of ["kc_sources", "knowledge_map_chunks"] as const) {
      const rows =
        table === "kc_sources"
          ? gold.gold.kcs.flatMap((kc) =>
              // The disputed KCs' only source is a figure title (a KC
              // without a source leaves the map), so the AI must search
              // for the pages that show the link.
              (kc.id === "KC04" || kc.id === "KC05" ? [3] : kc.sources).map(
                (position) => ({
                  ...owned,
                  kc_id: id(kc.id),
                  chunk_id: idAt.get(position) as string,
                }),
              ),
            )
          : chunkIds.map((chunkId) => ({ ...owned, chunk_id: chunkId }));
      const { error: insertError } = await supabase
        .from(table)
        .insert(rows as never);
      if (insertError) throw new Error(`${table}: ${insertError.message}`);
    }
    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("id")
      .eq("course_id", courseId)
      .single();
    if (materialError) throw new Error(materialError.message);
    await insertGoldTopics(supabase, studentId, courseId, gold, {
      materialId: material.id,
      chunkIds: [chunkIds[0] as string],
      studyText: "A jet engine pushes air backwards [p. 1].",
    });

    // Embed the chunks as ingestion does, so `searchMaterials` finds them.
    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("id, markdown")
      .eq("course_id", courseId)
      .order("position");
    if (chunksError) throw new Error(chunksError.message);
    for (let start = 0; start < chunks.length; start += 20) {
      const batch = chunks.slice(start, start + 20);
      const embedded = await meteredEmbed(
        supabase,
        { studentId, traceName: "smoke-embed" },
        { values: batch.map((chunk) => chunk.markdown) },
        async (vectors) => {
          const { error: rpcError } = await supabase.rpc(
            "set_chunk_embeddings",
            {
              p_embeddings: batch.map((chunk, index) => ({
                id: chunk.id,
                embedding: JSON.stringify(vectors[index]),
              })),
            },
          );
          if (rpcError) throw new Error(rpcError.message);
        },
      );
      if (!embedded) throw new Error("The embedding hit the daily limit.");
    }

    // One reply through the real Chat handler, as the Student.
    const client = await signInAsUser(supabase, studentId);
    console.info(`Student: ${DISPUTE}`);
    const response = await respondInChat({
      request: new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          chatId: randomUUID(),
          courseId,
          message: {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text: DISPUTE }],
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
        [kc_id, linked_kc_id].includes(id("KC04")) &&
        [kc_id, linked_kc_id].includes(id("KC05")),
    );
    const finding = wrong[0];
    const chunk = chunks.find((c) => c.id === finding?.chunk_id);
    const quoted =
      finding !== undefined &&
      chunk !== undefined &&
      squash(chunk.markdown).includes(squash(finding.quote));

    // Accept it as the Student, then run Update map (no new chunks).
    let status = "no Finding";
    let linkGone = false;
    let outcome = "";
    if (finding) {
      const accepted = await client
        .from("map_findings")
        .update({ status: "accepted" })
        .eq("id", finding.id);
      if (accepted.error) throw new Error(accepted.error.message);
      outcome = await build(supabase, courseId);
      const after = await supabase
        .from("map_findings")
        .select("status, outcome")
        .eq("id", finding.id)
        .maybeSingle();
      if (after.error) throw new Error(after.error.message);
      status = after.data
        ? `${after.data.status} (${after.data.outcome})`
        : "the Finding is gone";
      const links = await supabase
        .from("prerequisite_links")
        .select("from_kc, to_kc")
        .eq("course_id", courseId)
        .eq("from_kc", planted.from_kc)
        .eq("to_kc", planted.to_kc);
      if (links.error) throw new Error(links.error.message);
      linkGone = links.data.length === 0;
    }

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
      result(
        "the build after accepting is built",
        outcome === "built",
        outcome,
      ),
      result("the wrong link is gone", linkGone),
      result("the Finding is applied", status.startsWith("applied"), status),
    ];
  },
};
