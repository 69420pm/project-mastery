// Mutation testing for one unit at a time. `pnpm -s sweep mutate` (tools/sweep)
// sets the SWEEP_* variables; without them this covers every unit at once.
// The command runner is on purpose: see docs/agents/notes/stryker.md.
const env = process.env;

const config = {
  testRunner: "command",
  commandRunner: { command: `pnpm exec vitest run ${env.SWEEP_TESTS ?? ""}` },
  mutate: [
    ...(
      env.SWEEP_MUTATE ??
      "src/features/*/{domain,server,ai,workflows}/**/*.ts,src/lib/**/*.ts"
    ).split(","),
    "!**/*.test.ts",
    "!**/*-testing.ts",
    "!**/*.tsx",
    "!**/database.types.ts",
  ],
  ...(env.SWEEP_CONCURRENCY && { concurrency: Number(env.SWEEP_CONCURRENCY) }),
  // Copy only what the unit tests need into each sandbox.
  ignorePatterns: [
    "/*",
    "!/src",
    "!/tools",
    "!/evals",
    "!/package.json",
    "!/tsconfig.json",
    "!/vitest.config.mts",
    "!/vitest.setup.ts",
  ],
  reporters: ["json"],
  jsonReporter: { fileName: env.SWEEP_REPORT ?? ".sweep/mutation.json" },
  tempDirName: ".stryker-tmp",
};

export default config;
