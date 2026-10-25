import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Lets a browser on the host open `next dev` running in an OrbStack Linux
  // machine at <machine>.orb.local; Next.js otherwise blocks live reload
  // from any hostname but localhost. Development only.
  allowedDevOrigins: ["*.orb.local"],
  // Native bindings (.node files) load from node_modules at runtime; bundled,
  // they fail with "Cannot find native binding". Used to render PDF pages.
  // pdfjs-dist stays external so it reads its fonts from disk (see
  // src/features/ingestion/workflows/page-images.ts). mathjs stays external
  // so tracing ships it in node_modules, where the math runner's own process
  // loads it (src/features/study/server/math-runner.ts).
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "mathjs"],
  // Font and character map files are read at runtime, so tracing cannot see
  // them; without them a deployed function renders pages with no text.
  outputFileTracingIncludes: {
    "/.well-known/workflow/v1/flow": [
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
    ],
  },
};

// Compiles "use workflow" / "use step" directives (Vercel Workflow).
export default withWorkflow(nextConfig);
