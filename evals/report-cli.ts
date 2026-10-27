/**
 * Prints where every registered eval stands, from its latest Langfuse run:
 *
 *   pnpm evals:report
 *
 * Makes no model calls.
 */
// Must come first: lets evals import modules that use Next.js.
import "./next-aliases";
import { isLangfuseConfigured } from "@/lib/tracing/env";
import { loadFixtureIfPresent } from "./eval";
import { createReportLangfuse } from "./langfuse";
import { EVALS } from "./registry";
import { buildReport, formatReport } from "./report";

async function main() {
  if (!isLangfuseConfigured()) {
    console.info(
      "Langfuse keys not set: the report reads the latest runs from Langfuse (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY).",
    );
    process.exitCode = 1;
    return;
  }
  // An eval whose private fixture is not on this machine has nothing to report.
  const loaded = await Promise.all(
    EVALS.map(async (definition) => ({
      definition,
      fixture: await loadFixtureIfPresent(definition),
    })),
  );
  const inputs = loaded.flatMap(({ definition, fixture }) =>
    fixture ? [{ definition, total: fixture.items.length }] : [],
  );
  console.info(formatReport(await buildReport(createReportLangfuse(), inputs)));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
