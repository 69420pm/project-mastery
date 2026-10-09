import { z } from "zod";

/** The longest name a Student can give a Course, in characters. */
export const MAX_COURSE_NAME_LENGTH = 100;

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
