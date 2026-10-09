import { z } from "zod";

/** The longest name a Student can give a Course, in characters. */
export const MAX_COURSE_NAME_LENGTH = 100;

/** The longest name a Material can have, in characters. */
export const MAX_MATERIAL_NAME_LENGTH = 200;

/** What a Student sees for a Course that is missing or not theirs. */
export const courseNotFoundMessage = "This course does not exist.";

/** A Course name, shared by the forms and the Server Actions. */
const courseNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(
    MAX_COURSE_NAME_LENGTH,
    `Keep the name to ${MAX_COURSE_NAME_LENGTH} characters or fewer.`,
  );

/** Creating a Course from the Course list. */
export const createCourseSchema = z.object({ name: courseNameSchema });

/** A Course addressed by id. */
export const courseIdSchema = z.object({ courseId: z.uuid() });

/** Renaming a Course from its menu. */
export const renameCourseSchema = courseIdSchema.extend({
  name: courseNameSchema,
});

/** The largest Material a Student can upload: 20 MB. */
export const MAX_MATERIAL_SIZE_BYTES = 20 * 1024 * 1024;

/** The file types a Material can have. */
export const MATERIAL_MEDIA_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type MaterialMediaType = (typeof MATERIAL_MEDIA_TYPES)[number];

/** A Material name, shared by uploading and renaming. */
const materialNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(
    MAX_MATERIAL_NAME_LENGTH,
    `Keep the name to ${MAX_MATERIAL_NAME_LENGTH} characters or fewer.`,
  );

/**
 * A file to upload as a Material. The browser checks it before uploading and
 * the Server Action again before registering it, with the same messages.
 */
export const materialFileSchema = z.object({
  mediaType: z.enum(MATERIAL_MEDIA_TYPES, {
    error: "Upload a PDF or a PNG, JPEG or WebP image.",
  }),
  sizeBytes: z
    .number()
    .int()
    .min(1, "This file is empty.")
    .max(MAX_MATERIAL_SIZE_BYTES, "Keep each file to 20 MB or smaller."),
});

/** Where an upload for a new Material went: its id and Course. */
export const uploadIdsSchema = z.object({
  materialId: z.uuid(),
  courseId: z.uuid(),
});

/** Registering an uploaded Material in its Course. */
export const registerMaterialSchema = uploadIdsSchema.extend({
  ...materialFileSchema.shape,
  name: materialNameSchema,
});

/** A Material addressed by id. */
export const materialIdSchema = z.object({ materialId: z.uuid() });

/**
 * A Material attached to a Chat message: its id, with its name and type when
 * it was attached. Messages store this reference, never the file.
 */
export const materialReferenceSchema = z.object({
  materialId: z.uuid(),
  name: z.string().min(1).max(MAX_MATERIAL_NAME_LENGTH),
  mediaType: z.enum(MATERIAL_MEDIA_TYPES),
});

export type MaterialReference = z.infer<typeof materialReferenceSchema>;

/** Renaming a Material from its menu. */
export const renameMaterialSchema = materialIdSchema.extend({
  name: materialNameSchema,
});
