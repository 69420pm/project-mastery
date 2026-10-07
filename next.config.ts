import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Lets a browser on the host open `next dev` running in an OrbStack Linux
  // machine at <machine>.orb.local; Next.js otherwise blocks live reload
  // from any hostname but localhost. Development only.
  allowedDevOrigins: ["*.orb.local"],
};

// Compiles "use workflow" / "use step" directives (Vercel Workflow).
export default withWorkflow(nextConfig);
