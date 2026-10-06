import { z } from "zod";

/** Validation messages per top-level input field, for rendering next to it. */
export type FieldErrors = Partial<Record<string, string[]>>;

/**
 * The return shape of every Server Action. Expected failures (invalid input,
 * missing permission) are returned, not thrown, so the client can render
 * them; unexpected errors still throw and reach the error boundary.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

export type ActionFailure = Extract<ActionResult<never>, { ok: false }>;

/**
 * Validates Server Action input against a Zod schema. Accepts `FormData`
 * (from `<form action>`) or a plain value (from a direct call); Server Action
 * arguments come from the client, so they are never trusted as typed.
 *
 * The failure branch is a ready-made `ActionResult`, so actions return it as is:
 *
 * ```ts
 * export async function renameCourse(input: FormData): Promise<ActionResult> {
 *   const parsed = parseActionInput(renameCourseSchema, input);
 *   if (!parsed.ok) return parsed;
 *   // parsed.data is typed
 * }
 * ```
 */
export function parseActionInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { ok: true; data: z.output<T> } | ActionFailure {
  const result = schema.safeParse(
    input instanceof FormData ? formDataToObject(input) : input,
  );
  if (result.success) return { ok: true, data: result.data };

  const { formErrors, fieldErrors } = z.flattenError(result.error);
  return {
    ok: false,
    message: formErrors[0] ?? "Please check the highlighted fields.",
    fieldErrors: fieldErrors as FieldErrors,
  };
}

/**
 * Converts `FormData` into a plain object for schema validation. Keys that
 * appear more than once (checkbox groups, multi-selects) become arrays.
 * Empty text inputs and empty file inputs become `undefined`, so optional
 * fields left blank pass `.optional()` and required ones fail.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((value) => !isEmpty(value));
    object[key] = values.length > 1 ? values : values[0];
  }
  return object;
}

function isEmpty(value: FormDataEntryValue): boolean {
  return typeof value === "string"
    ? value === ""
    : value.size === 0 && value.name === "";
}
