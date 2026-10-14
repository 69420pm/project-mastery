import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { z } from "zod";
import { parseMaterial } from "@/features/ingestion/server";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

const DEFAULT_FILE = "e2e/files/lecture-notes.pdf";

/** The option that writes the parsed chunks to a file. */
const CHUNKS_OUT = "--chunks-out";

/**
 * One vision call per page, plus the chunk call, the embedding call and at
 * most one pairing call must stay within the runner's cap of 30 calls.
 */
const MAX_PAGES = 10;

/** A stored figure: a page and a box normalized to it, or the whole page. */
const figureSchema = z.object({
  page: z.number(),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable(),
});

/** Rounding slack for boxes that end exactly at the page's edge. */
const EPSILON = 1e-6;

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function pageCount(bytes: Uint8Array, mediaType: string) {
  if (mediaType !== "application/pdf") return 1;
  // getDocumentProxy takes ownership of its buffer, so it gets a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  return pdf.numPages;
}

/**
 * Parses one file as a new Material with the real `parseMaterial` workflow,
 * run in this process, and checks what the parse stored.
 */
export const parseSmoke: SmokeCheck = {
  name: "parse",
  usage: `pnpm smoke parse [file] [${CHUNKS_OUT} chunks.json] (PDF of at most ${MAX_PAGES} pages, or an image; default ${DEFAULT_FILE}; writes the chunks to a file)`,
  async run({ supabase, studentId, args }) {
    const { file, chunksOut } = parseArgs(args);
    const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!mediaType) throw new Error(`${file} is no PDF, PNG, JPEG or WebP.`);
    const bytes = new Uint8Array(await readFile(file));
    const pages = await pageCount(bytes, mediaType);
    if (pages > MAX_PAGES) {
      throw new Error(
        `${file} has ${pages} pages; a smoke check reads at most ${MAX_PAGES}.`,
      );
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (courseError) throw new Error(courseError.message);

    const materialId = randomUUID();
    const storagePath = `${studentId}/${course.id}/${materialId}`;
    const upload = await supabase.storage
      .from(MATERIALS_BUCKET)
      .upload(storagePath, bytes, { contentType: mediaType });
    if (upload.error) throw new Error(upload.error.message);
    const { error: materialError } = await supabase.from("materials").insert({
      id: materialId,
      owner: studentId,
      course_id: course.id,
      name: path.basename(file),
      media_type: mediaType,
      size_bytes: bytes.byteLength,
      storage_path: storagePath,
    });
    if (materialError) throw new Error(materialError.message);

    console.info(`Parsing ${file} (${pages} page${pages > 1 ? "s" : ""})…`);
    await parseMaterial(materialId);
    const results = await checkParse(supabase, materialId, pages);
    if (chunksOut) await writeChunks(supabase, materialId, chunksOut);
    return results;
  },
};

function parseArgs(args: string[]) {
  const at = args.indexOf(CHUNKS_OUT);
  const chunksOut = at === -1 ? undefined : args[at + 1];
  if (at !== -1 && !chunksOut) throw new Error(`${CHUNKS_OUT} needs a file.`);
  const rest = at === -1 ? args : args.toSpliced(at, 2);
  return { file: rest[0] ?? DEFAULT_FILE, chunksOut };
}

/**
 * Writes the parsed chunks as a fixture other checks insert as chunks
 * (`evals/gold/*\/chunks.json`), without ids, figure boxes or embeddings.
 * Each exercise subtask chunk gets the position of its paired solution
 * chunk, or null without one.
 */
async function writeChunks(
  supabase: Parameters<SmokeCheck["run"]>[0]["supabase"],
  materialId: string,
  file: string,
) {
  const { data, error } = await supabase
    .from("chunks")
    .select(
      "id, position, page_from, page_to, label, markdown, exercise_number, points, figure",
    )
    .eq("material_id", materialId)
    .order("position");
  if (error) throw new Error(error.message);
  const pairs = await supabase
    .from("exercise_solutions")
    .select("exercise_chunk_id, solution_chunk_id")
    .in(
      "exercise_chunk_id",
      data.map((chunk) => chunk.id),
    );
  if (pairs.error) throw new Error(pairs.error.message);
  const positionOf = new Map(data.map((chunk) => [chunk.id, chunk.position]));
  const solutionOf = new Map(
    pairs.data.map((pair) => [
      pair.exercise_chunk_id,
      pair.solution_chunk_id === null
        ? null
        : (positionOf.get(pair.solution_chunk_id) ?? null),
    ]),
  );
  const fixture = data.map(({ id, figure, ...chunk }) => ({
    ...chunk,
    figure_description:
      z.object({ description: z.string() }).safeParse(figure).data
        ?.description ?? null,
    ...(solutionOf.has(id) && { solution_position: solutionOf.get(id) }),
  }));
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.info(`Wrote ${fixture.length} chunks to ${file}.`);
}

async function checkParse(
  supabase: Parameters<SmokeCheck["run"]>[0]["supabase"],
  materialId: string,
  pages: number,
): Promise<SmokeResult[]> {
  const [material, storedPages, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("parse_status, parse_failure, pages_done, pages_total")
      .eq("id", materialId)
      .single(),
    supabase
      .from("material_pages")
      .select("page_number, units")
      .eq("material_id", materialId),
    supabase
      .from("chunks")
      .select(
        "position, page_from, page_to, label, markdown, figure, embedding",
      )
      .eq("material_id", materialId)
      .order("position"),
  ]);
  for (const { error } of [material, storedPages, chunks]) {
    if (error) throw new Error(error.message);
  }
  const m = material.data!;
  const rows = chunks.data!;
  const units = storedPages.data!.flatMap((page) =>
    Array.isArray(page.units) ? page.units : [],
  );

  for (const chunk of rows.slice(0, 5)) {
    const text = chunk.markdown.replaceAll(/\s+/g, " ").slice(0, 100);
    console.info(
      `  ${chunk.position} ${chunk.label} p${chunk.page_from}: ${text}`,
    );
  }

  const outOfRange = rows.filter(
    (c) => c.page_from < 1 || c.page_to > pages || c.page_from > c.page_to,
  );
  const badFigures = rows.filter((c) => {
    if (c.figure === null) return false;
    const figure = figureSchema.safeParse(c.figure);
    if (!figure.success) return true;
    const { page, box } = figure.data;
    const inBox =
      !box ||
      (box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 1 + EPSILON &&
        box.y + box.height <= 1 + EPSILON);
    return page < 1 || page > pages || !inBox;
  });

  return [
    result(
      "the Material is parsed",
      m.parse_status === "parsed",
      m.parse_status === "parsed"
        ? undefined
        : `${m.parse_status}: ${m.parse_failure}`,
    ),
    result(
      "every page has a stored result",
      storedPages.data!.length === pages &&
        m.pages_done === pages &&
        m.pages_total === pages,
      `${storedPages.data!.length} results, pages_done ${m.pages_done}, pages_total ${m.pages_total}, expected ${pages}`,
    ),
    result("the pages hold units", units.length > 0, `${units.length} units`),
    result("the Material has chunks", rows.length > 0, `${rows.length} chunks`),
    result(
      "chunk positions run from 0 without gaps",
      rows.every((c, i) => c.position === i),
    ),
    result(
      "every chunk has markdown",
      rows.every((c) => c.markdown.trim().length > 0),
    ),
    result(
      "every chunk cites pages of the Material",
      outOfRange.length === 0,
      outOfRange.length ? `${outOfRange.length} out of range` : undefined,
    ),
    result(
      "every figure lies on a page",
      badFigures.length === 0,
      badFigures.length
        ? `${badFigures.length} figures off their page`
        : undefined,
    ),
    result(
      "every chunk is embedded",
      rows.every((c) => c.embedding !== null),
    ),
  ];
}
