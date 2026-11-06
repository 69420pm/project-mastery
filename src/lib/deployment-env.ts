/**
 * Where the server runs, from the system environment variables Vercel sets.
 * Server-side only: these variables are not exposed to the browser.
 */
export function isVercelDeployment(): boolean {
  return Boolean(process.env.VERCEL);
}

/** Whether this is the production deployment, not a preview or local run. */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
