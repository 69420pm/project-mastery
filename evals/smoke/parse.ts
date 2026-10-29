import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { parseMaterial } from "@/features/ingestion/server";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import { result, type SmokeCheck, type SmokeResult } from "./smoke-check";

const DEFAULT_FILE = "e2e/files/lecture-notes.pdf";

/** The option that selects pages: `19-22`, `3,5` or `3,5,19-22`. */
const PAGES = "--pages";

/**
 * The option that writes the stored page results to a JSON file, keyed by
 * the file's name, so the results of several files share one recording
 * (`evals/gold/linear-algebra-I/pages.json`).
 */
const PAGES_OUT = "--pages-out";

/**
 * One vision call per page, plus the embedding call and at most one pairing
 * call, must stay within the runner's cap of 30 calls.
 */
const MAX_PAGES = 10;

const SKIP_REASONS = ["blank", "overlay", "unreadable"];

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
 * Parses one file, or a selection of its pages, as a new Material with the
 * real `parseMaterial` workflow, run in this process, and checks what the
 * parse stored. Pinned to MiMo, the model that ships.
 */
export const parseSmoke: SmokeCheck = {
  name: "parse",
  model: "xiaomi/mimo-v2.6-flash",
  usage: `pnpm smoke parse [file] [${PAGES} 3,5,19-22] [${PAGES_OUT} pages.json] (PDF or image; at most ${MAX_PAGES} pages read; default ${DEFAULT_FILE}; writes the page results to a file)`,
  async run({ supabase, studentId, args }) {
    const { file, pages: selection, pagesOut } = parseArgs(args);
    const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!mediaType) throw new Error(`${file} is no PDF, PNG, JPEG or WebP.`);
    const bytes = new Uint8Array(await readFile(file));
    const total = await pageCount(bytes, mediaType);
    const pages =
      selection ?? Array.from({ length: total }, (_, index) => index + 1);
    if (pages.some((page) => page < 1 || page > total)) {
      throw new Error(`${file} has ${total} pages.`);
    }
    if (pages.length > MAX_PAGES) {
      throw new Error(
        `${pages.length} pages selected; a smoke check reads at most ${MAX_PAGES}.`,
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

    console.info(`Parsing ${file}, pages ${pages.join(", ")}…`);
    await parseMaterial(materialId, selection ? { pages } : {});
    const results = await checkParse(supabase, materialId, pages, total);
    if (pagesOut) await writePages(supabase, materialId, file, pagesOut);
    return results;
  },
};

/** `3,5,19-22` as page numbers, in order. */
function pageList(text: string): number[] {
  const pages = text.split(",").flatMap((part) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const from = Number(match?.[1]);
    const to = Number(match?.[2] ?? match?.[1]);
    if (!match || to < from) {
      throw new Error(`${PAGES} takes pages such as 3,5,19-22, not ${text}.`);
    }
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
  return [...new Set(pages)].toSorted((a, b) => a - b);
}

function parseArgs(args: string[]) {
  let rest = args;
  const option = (name: string) => {
    const at = rest.indexOf(name);
    if (at === -1) return undefined;
    const value = rest[at + 1];
    if (!value) throw new Error(`${name} needs a value.`);
    rest = rest.toSpliced(at, 2);
    return value;
  };
  const pages = option(PAGES);
  const pagesOut = option(PAGES_OUT);
  return {
    file: rest[0] ?? DEFAULT_FILE,
    pages: pages === undefined ? undefined : pageList(pages),
    pagesOut,
  };
}

/**
 * Writes the stored page results under the file's name into `out`, keeping
 * the other files' results there: rows later slices insert as
 * `material_pages` without a Material.
 */
async function writePages(
  supabase: Parameters<SmokeCheck["run"]>[0]["supabase"],
  materialId: string,
  file: string,
  out: string,
) {
  const { data, error } = await supabase
    .from("material_pages")
    .select("page_number, skipped, language, units")
    .eq("material_id", materialId)
    .order("page_number");
  if (error) throw new Error(error.message);
  let recording: Record<string, unknown> = {};
  try {
    recording = JSON.parse(await readFile(out, "utf8"));
  } catch {
    // A new recording.
  }
  recording[path.basename(file)] = data;
  const sorted = Object.fromEntries(
    Object.entries(recording).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(out, `${JSON.stringify(sorted, null, 2)}\n`);
  console.info(`Wrote ${data.length} pages of ${file} to ${out}.`);
}

type Unit = { markdown?: unknown };

/** A unit that is only a page number: "19", "- 19 -", "Seite 19 von 38". */
const PAGE_NUMBER = /^\W*(page|seite|s\.)?\s*\d+(\s*(of|von|\/)\s*\d+)?\W*$/i;

async function checkParse(
  supabase: Parameters<SmokeCheck["run"]>[0]["supabase"],
  materialId: string,
  pages: number[],
  total: number,
): Promise<SmokeResult[]> {
  const [material, storedPages, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("parse_status, parse_failure, language")
      .eq("id", materialId)
      .single(),
    supabase
      .from("material_pages")
      .select("page_number, skipped, language, units")
      .eq("material_id", materialId)
      .order("page_number"),
    supabase
      .from("chunks")
      .select("position, page_from, page_to, label, markdown, embedding")
      .eq("material_id", materialId)
      .order("position"),
  ]);
  for (const { error } of [material, storedPages, chunks]) {
    if (error) throw new Error(error.message);
  }
  const m = material.data!;
  const rows = storedPages.data!;
  const chunkRows = chunks.data!;
  const unitsOf = (page: (typeof rows)[number]) =>
    (Array.isArray(page.units) ? page.units : []) as Unit[];

  for (const page of rows) {
    const units = unitsOf(page);
    console.info(
      `  p${page.page_number} ${page.skipped ?? page.language}: ${units.length} units`,
    );
    for (const unit of units.slice(0, 3)) {
      const text = String(unit.markdown).replaceAll(/\s+/g, " ").slice(0, 90);
      console.info(`    ${text}`);
    }
  }

  const unaccounted = pages.filter((page) => {
    const row = rows.find((r) => r.page_number === page);
    return (
      !row ||
      (row.skipped === null
        ? row.language === null
        : !SKIP_REASONS.includes(row.skipped))
    );
  });
  const pageNumberUnits = rows.flatMap((page) =>
    unitsOf(page)
      .filter((unit) => PAGE_NUMBER.test(String(unit.markdown).trim()))
      .map(() => page.page_number),
  );
  // A running header repeats on every page; a unit on 3 pages is one.
  const unitPages = new Map<string, Set<number>>();
  for (const page of rows) {
    for (const unit of unitsOf(page)) {
      const text = String(unit.markdown).trim();
      unitPages.set(
        text,
        (unitPages.get(text) ?? new Set()).add(page.page_number),
      );
    }
  }
  const repeated = [...unitPages].filter(([, on]) => on.size >= 3);
  const outOfRange = chunkRows.filter(
    (c) => c.page_from < 1 || c.page_to > total || c.page_from > c.page_to,
  );

  return [
    result(
      "the Material is parsed",
      m.parse_status === "parsed",
      m.parse_status === "parsed"
        ? `language ${m.language}`
        : `${m.parse_status}: ${m.parse_failure}`,
    ),
    result(
      "every page is read, with a language, or skipped with a reason",
      unaccounted.length === 0,
      unaccounted.length ? `pages ${unaccounted.join(", ")}` : undefined,
    ),
    result(
      "no unit is a page number",
      pageNumberUnits.length === 0,
      pageNumberUnits.length
        ? `pages ${pageNumberUnits.join(", ")}`
        : undefined,
    ),
    result(
      "no unit repeats on 3 pages, as a running header would",
      repeated.length === 0,
      repeated.map(([text]) => text.slice(0, 60)).join(" | ") || undefined,
    ),
    result(
      "chunk positions run from 0 without gaps",
      chunkRows.every((c, i) => c.position === i),
    ),
    result(
      "every chunk has markdown and cites pages of the Material",
      chunkRows.every((c) => c.markdown.trim().length > 0) &&
        outOfRange.length === 0,
    ),
    result(
      "every chunk is embedded",
      chunkRows.every((c) => c.embedding !== null),
    ),
  ];
}
