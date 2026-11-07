/**
 * Postgres cannot store a NUL character in text or jsonb: the insert fails
 * with "unsupported Unicode escape sequence". Model output and PDF text can
 * hold one (a garbled glyph), so every server Supabase client sends its JSON
 * request bodies through this `fetch`, which drops them. One place guards
 * every write, whatever the table or the model call behind it.
 */

/**
 * A JSON `\u0000` escape, not a backslash-escaped backslash followed by the
 * text `u0000`: the lookbehind and the pairs skip an even run of backslashes.
 */
const NUL_ESCAPE = /(?<!\\)((?:\\\\)*)\\u0000/g;

/** The JSON text without its `\u0000` escapes. */
export function withoutNul(json: string): string {
  return json.includes("\\u0000") ? json.replace(NUL_ESCAPE, "$1") : json;
}

/** `fetch` that removes NUL characters from JSON string bodies. */
export const fetchWithoutNul: typeof fetch = (input, init) => {
  if (
    typeof init?.body === "string" &&
    new Headers(init.headers).get("content-type")?.includes("json")
  ) {
    return fetch(input, { ...init, body: withoutNul(init.body) });
  }
  return fetch(input, init);
};
