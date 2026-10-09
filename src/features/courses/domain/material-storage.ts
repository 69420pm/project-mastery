/** The Storage bucket that holds the files of Materials. */
export const MATERIALS_BUCKET = "course-files";

/** The folder in `MATERIALS_BUCKET` that holds a Course's files. */
export function courseFolder(owner: string, courseId: string): string {
  return `${owner}/${courseId}`;
}

/**
 * Where a Material's file is stored: in its owner's folder, which the bucket
 * policies require, under its Course.
 */
export function materialStoragePath(
  owner: string,
  courseId: string,
  materialId: string,
): string {
  return `${courseFolder(owner, courseId)}/${materialId}`;
}
