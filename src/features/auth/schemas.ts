import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInSchema = z.object({
  email: emailSchema,
  // Only the sign-up rules are enforced on new passwords; any stored password
  // may sign in.
  password: z.string().min(1).max(72),
});

export const signUpSchema = z.object({
  email: emailSchema,
  // 8 matches `minimum_password_length` in supabase/config.toml; bcrypt reads
  // at most 72 bytes.
  password: z.string().min(8).max(72),
});

export const magicLinkSchema = z.object({ email: emailSchema });
