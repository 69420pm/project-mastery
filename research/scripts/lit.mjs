#!/usr/bin/env node
// Compact OpenAlex client for literature research. No dependencies.
// Run with --help for usage.

const API = "https://api.openalex.org";
const FIELDS =
  "id,doi,title,publication_year,type,cited_by_count,is_retracted,open_access,best_oa_location,primary_location,authorships,abstract_inverted_index,referenced_works";

const HELP = `Usage: node scripts/lit.mjs <command> [args]

  search "<query>" [--reviews] [--from YEAR] [-n N]   relevance-ranked works (default 10)
  doi <doi>                                          one work in full, with its abstract
  refs <doi> [-n N]                                  works it cites, most cited first
  cited-by <doi> [-n N]                              works citing it, most cited first
  pdf <doi>                                          download the open-access PDF to pdfs/

Set OPENALEX_API_KEY or OPENALEX_MAILTO for higher rate limits.`;

const args = process.argv.slice(2);
const [command, target] = args;
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const limit = Number(option("-n", 10));

async function get(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (process.env.OPENALEX_API_KEY)
    url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO)
    url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  const res = await fetch(url);
  if (res.status === 404) fail(`Not found in OpenAlex: ${path}`);
  if (!res.ok) fail(`OpenAlex ${res.status}: ${await res.text()}`);
  return res.json();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const bareDoi = (doi) => doi?.replace("https://doi.org/", "") ?? "no DOI";
const shortId = (id) => id.replace("https://openalex.org/", "");

function abstract(work) {
  const index = work.abstract_inverted_index;
  if (!index) return null;
  const words = [];
  for (const [word, positions] of Object.entries(index))
    for (const p of positions) words[p] = word;
  return words.join(" ");
}

function authors(work) {
  const names = work.authorships.map((a) => a.author.display_name);
  return names.length > 3 ? `${names[0]} et al.` : names.join(", ");
}

function line(work, abstractChars = 300) {
  const venue = work.primary_location?.source?.display_name ?? "";
  const oa = work.best_oa_location?.pdf_url ?? work.open_access?.oa_url;
  const text = abstract(work);
  return [
    `${work.title} (${work.publication_year}) ${work.type}`,
    `  ${authors(work)} | ${venue}`,
    `  doi:${bareDoi(work.doi)} | cited ${work.cited_by_count}${work.is_retracted ? " | RETRACTED" : ""} | ${oa ? `OA ${oa}` : "no OA"}`,
    text
      ? `  ${abstractChars && text.length > abstractChars ? text.slice(0, abstractChars) + "…" : text}`
      : "  (no abstract in OpenAlex)",
  ].join("\n");
}

const print = (works, chars) =>
  console.log(works.map((w) => line(w, chars)).join("\n\n") || "No results.");

const work = (doi) => get(`/works/doi:${bareDoi(doi)}`, { select: FIELDS });

async function main() {
  if (!command || flag("--help") || (command !== "search" && !target))
    return console.log(HELP);

  if (command === "search") {
    const filter = [
      flag("--reviews") && "type:review",
      option("--from") && `from_publication_date:${option("--from")}-01-01`,
    ].filter(Boolean);
    const params = { search: target, "per-page": limit, select: FIELDS };
    if (filter.length) params.filter = filter.join(",");
    return print((await get("/works", params)).results);
  }

  if (command === "doi") return print([await work(target)], 0);

  if (command === "refs") {
    const ids = (await work(target)).referenced_works.map(shortId);
    if (!ids.length) return console.log("No references in OpenAlex.");
    const params = {
      filter: `openalex:${ids.slice(0, 100).join("|")}`,
      sort: "cited_by_count:desc",
      "per-page": limit,
      select: FIELDS,
    };
    return print((await get("/works", params)).results, 150);
  }

  if (command === "cited-by") {
    const id = shortId((await work(target)).id);
    const params = {
      filter: `cites:${id}`,
      sort: "cited_by_count:desc",
      "per-page": limit,
      select: FIELDS,
    };
    return print((await get("/works", params)).results, 150);
  }

  if (command === "pdf") {
    const w = await work(target);
    const url = w.best_oa_location?.pdf_url;
    if (!url) fail(`No open-access PDF for ${bareDoi(w.doi)}; ask the user.`);
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("pdf"))
      fail(`Could not download a PDF from ${url} (${res.status} ${type}).`);
    const { writeFile } = await import("node:fs/promises");
    const file = new URL(
      `../pdfs/${bareDoi(w.doi).replace(/[^\w.-]+/g, "_")}.pdf`,
      import.meta.url,
    );
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return console.log(`Saved ${file.pathname}`);
  }

  console.log(HELP);
}

await main();
