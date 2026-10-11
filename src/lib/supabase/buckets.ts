/**
 * The Storage bucket that holds the files of Materials, their page images and
 * figure crops. Shared by `courses` (uploads) and `ingestion` (parsing), which
 * cannot import each other's internals.
 */
export const MATERIALS_BUCKET = "course-files";
