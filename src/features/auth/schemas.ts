import { z } from "zod";

const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254));

export const signInSchema = z.object({
  email: emailSchema,
  // Only the sign-up rules are enforced on new passwords; any stored password
  // may sign in.
  password: z.string({ error: "Enter your password." }).min(1).max(72),
});

export const signUpSchema = z.object({
  email: emailSchema,
  // 8 matches `minimum_password_length` in supabase/config.toml; bcrypt reads
  // at most 72 bytes.
  password: z
    .string({ error: "Choose a password." })
    .min(8, { error: "Use at least 8 characters." })
    .max(72, { error: "Use at most 72 characters." }),
});

export const magicLinkSchema = z.object({ email: emailSchema });
