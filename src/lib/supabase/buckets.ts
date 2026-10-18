/**
 * The Storage bucket that holds the uploaded files of Materials; a parse
 * stores no page images or figure crops. Shared by `courses` (uploads) and
 * `ingestion` (parsing), which cannot import each other's internals.
 */
export const MATERIALS_BUCKET = "course-files";
