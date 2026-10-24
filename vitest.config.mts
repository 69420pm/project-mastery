import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // A file's first test pays for importing its modules, about 1.4s on the
    // chat handler alone, and goes over 5s when the machine is busy.
    testTimeout: 15_000,
    include: [
      "src/**/*.test.{ts,tsx}",
      "tools/**/*.test.ts",
      "evals/**/*.test.ts",
      "eslint/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
    },
  },
});
