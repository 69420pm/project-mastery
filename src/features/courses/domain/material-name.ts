import { MAX_MATERIAL_NAME_LENGTH } from "@/features/courses/schemas";

/**
 * The name a new Material gets: its filename without the extension, trimmed
 * and cut to the longest allowed name. A filename that is only an extension
 * (".pdf") keeps it, so the name is never empty.
 */
export function materialNameFromFilename(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const name = base.trim().slice(0, MAX_MATERIAL_NAME_LENGTH).trim();
  return name || "Untitled";
}
