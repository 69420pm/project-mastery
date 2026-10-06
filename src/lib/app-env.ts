import { z } from "zod";
import { parseEnv } from "@/lib/env";

/**
 * App-wide public variables. Everything here is `NEXT_PUBLIC_*`, so this
 * module is safe to import from both Server and Client Components.
 */
const appEnvSchema = z.object({
  // Canonical origin without a trailing slash, e.g. for absolute links,
  // `metadataBase` and auth redirect URLs.
  NEXT_PUBLIC_SITE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

type SiteUrlSource = {
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_VERCEL_ENV?: string;
  NEXT_PUBLIC_VERCEL_URL?: string;
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?: string;
};

/**
 * Picks the site origin: an explicit `NEXT_PUBLIC_SITE_URL` wins, then the
 * system variables Vercel exposes to Next.js (production domain in
 * production, the deployment URL in previews), then local development.
 */
export function resolveSiteUrl(source: SiteUrlSource): string {
  if (source.NEXT_PUBLIC_SITE_URL) return source.NEXT_PUBLIC_SITE_URL;
  if (
    source.NEXT_PUBLIC_VERCEL_ENV === "production" &&
    source.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
  ) {
    return `https://${source.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (source.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${source.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

let appEnv: AppEnv | undefined;

/** Validates the app-wide public variables on first use. */
export function getAppEnv(): AppEnv {
  appEnv ??= parseEnv(appEnvSchema, {
    // Referenced one by one so Next.js inlines them in the browser bundle.
    NEXT_PUBLIC_SITE_URL: resolveSiteUrl({
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
      NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
        process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
    }),
  });
  return appEnv;
}
