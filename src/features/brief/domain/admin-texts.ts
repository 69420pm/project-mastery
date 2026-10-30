import type { AdminText } from "@/features/brief/domain/intake";

/** The most of the admin texts the Brief's context holds, in tokens. */
const MAX_ADMIN_TOKENS = 4_000;
const CHARACTERS_PER_TOKEN = 4;

/** An admin chunk of the Course, in Course order. */
export type AdminChunk = {
  materialName: string;
  pageFrom: number;
  markdown: string;
};

/** What makes two admin texts the same: whitespace collapsed, no digits. */
function key(markdown: string): string {
  return markdown.replace(/\d/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The distinct admin texts of the Course: each once, with where it first
 * appears as "<Material> p. N", in Course order, up to 4,000 tokens. Texts
 * that differ only in whitespace or digits, such as a running footer with
 * page numbers, count as one.
 */
export function distinctAdminTexts(chunks: AdminChunk[]): AdminText[] {
  const seen = new Set<string>();
  const texts: AdminText[] = [];
  let budget = MAX_ADMIN_TOKENS * CHARACTERS_PER_TOKEN;
  for (const { materialName, pageFrom, markdown } of chunks) {
    const text = markdown.trim();
    const id = key(text);
    if (id === "" || seen.has(id)) continue;
    if (text.length > budget) break;
    seen.add(id);
    budget -= text.length;
    texts.push({ text, source: `${materialName} p. ${pageFrom}` });
  }
  return texts;
}
