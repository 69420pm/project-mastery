import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

// Compiles "use workflow" / "use step" directives (Vercel Workflow).
export default withWorkflow(nextConfig);
