// Enforces the project structure in docs/ARCHITECTURE.md ("Project
// structure"): where files may live, which layers may import which, and where
// infrastructure packages may be used. Every message names the fix, because
// agents act on lint output directly.
import boundaries from "eslint-plugin-boundaries";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import checkFile from "eslint-plugin-check-file";
import importX from "eslint-plugin-import-x";
import project from "./plugin/index.mjs";

const DOCS = "See docs/ARCHITECTURE.md, Project structure.";

/**
 * Every source file must match one of these patterns. Adding a pattern is an
 * architecture change: update docs/ARCHITECTURE.md in the same PR.
 */
const ALLOWED_FILES = [
  // Routing only: Next.js special files. Code they need lives in features/.
  "src/app/**/{page,layout,template,loading,error,not-found,forbidden,unauthorized,default}.tsx",
  "src/app/{global-error,global-not-found}.tsx",
  "src/app/**/route.ts",
  "src/app/**/{icon,apple-icon,opengraph-image,twitter-image}.tsx",
  "src/app/{sitemap,robots,manifest}.ts",
  // One folder per product capability, with a fixed inner layout.
  "src/features/*/{index,server,schemas,types}.ts",
  "src/features/*/components/**/*.tsx",
  "src/features/*/hooks/use-*.ts",
  "src/features/*/{server,ai,workflows,domain}/**/*.ts",
  // Shared code without domain knowledge.
  "src/components/**/*.tsx",
  "src/hooks/use-*.ts",
  "src/lib/**/*.ts",
  // Next.js root files.
  "src/{proxy,instrumentation,instrumentation-client}.ts",
  // Evaluation datasets and runner for AI behavior (decision 12).
  "evals/*.ts",
  // CLI that lets coding agents drive the running app (decision 15).
  "tools/agent/*.ts",
];

/** Unit tests sit next to the file they test, under the same name. */
const TEST_FILES = "{src,tools}/**/*.test.{ts,tsx}";

const ENV_FILES = ["src/**/env.ts", "src/**/*-env.ts"];

// Packages that only one place may use. Type-only imports are allowed
// everywhere, so code can name the types these packages return.
const RESTRICTED_PACKAGES = [
  {
    source: "@supabase/*",
    allowedIn: ["src/lib/supabase/**"],
    message:
      "Use the Supabase clients in @/lib/supabase (server.ts for requests, admin.ts for background jobs) instead of {{to.module.source}}. Type-only imports are fine.",
  },
  {
    source: "workflow{,/**}",
    allowedIn: ["src/features/*/workflows/**", "src/features/*/server/**"],
    message:
      "Durable workflows live in src/features/<feature>/workflows/ and start from the feature's server/ code; {{to.module.source}} is not allowed here.",
  },
  {
    source: "@ai-sdk/!(react)",
    allowedIn: ["src/lib/ai/**"],
    message:
      "Model providers are configured once in src/lib/ai/models.ts (ARCHITECTURE decision 5). Call models through `aiTask(...)` instead of importing {{to.module.source}}.",
  },
  {
    source: "@{langfuse,opentelemetry}/*",
    allowedIn: ["src/lib/tracing/**", "evals/**"],
    message:
      "Tracing is set up in src/lib/tracing; use `withTraceAttributes` and `flushTraces` from @/lib/tracing instead of {{to.module.source}}.",
  },
];

/** A path pattern matching files outside all the given patterns. */
const notIn = (patterns) =>
  patterns.length === 1 ? `!${patterns[0]}` : `!{${patterns.join(",")}}`;

/** Allow importing a feature only through its public entry files. */
const featureEntries = (entries) => ({
  element: { type: "feature", fileInternalPath: entries },
});

export const architecture = [
  {
    name: "project/architecture",
    files: ["src/**/*.{ts,tsx}", "evals/**/*.ts", "tools/**/*.ts"],
    plugins: { boundaries, project },
    settings: {
      "boundaries/include": ["src/**", "evals/**", "tools/**"],
      "boundaries/elements": [
        { type: "app", pattern: "src/app", partialMatch: false },
        {
          type: "feature",
          pattern: "src/features/*",
          capture: ["feature"],
          partialMatch: false,
        },
        { type: "components", pattern: "src/components", partialMatch: false },
        { type: "hooks", pattern: "src/hooks", partialMatch: false },
        { type: "lib", pattern: "src/lib", partialMatch: false },
        { type: "evals", pattern: "evals", partialMatch: false },
        // Development tooling: drives the app from outside, imports none of it.
        { type: "tools", pattern: "tools/*", partialMatch: false },
        // Root files such as proxy.ts and instrumentation.ts.
        { type: "root", pattern: "src", partialMatch: false },
      ],
      // Re-exports and dynamic imports are dependencies too.
      "boundaries/dependency-nodes": ["import", "export", "dynamic-import"],
      "boundaries/legacy-templates": false,
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          message: `Code in {{from.element.types}} may not import this module ({{to.element.types}}). ${DOCS}`,
          policies: [
            // Packages and Node built-ins, narrowed by RESTRICTED_PACKAGES below.
            {
              allow: {
                to: [
                  { module: { origin: "external" } },
                  { module: { origin: "core" } },
                ],
              },
            },
            {
              from: { element: { type: "app" } },
              allow: {
                to: [
                  {
                    element: {
                      types: { anyOf: ["components", "hooks", "lib"] },
                    },
                  },
                  featureEntries("{index,server}.ts"),
                ],
              },
            },
            {
              from: { element: { type: "feature" } },
              allow: {
                to: [
                  {
                    element: {
                      types: { anyOf: ["components", "hooks", "lib"] },
                    },
                  },
                  featureEntries("{index,server}.ts"),
                ],
              },
            },
            {
              from: { element: { type: "components" } },
              allow: {
                to: { element: { types: { anyOf: ["hooks", "lib"] } } },
              },
            },
            {
              from: { element: { type: "hooks" } },
              allow: { to: { element: { type: "lib" } } },
            },
            {
              from: { element: { types: { anyOf: ["root", "evals"] } } },
              allow: {
                to: [{ element: { type: "lib" } }, featureEntries("server.ts")],
              },
            },
            // Messages for the most likely mistakes, instead of the generic one.
            {
              from: { element: { types: { anyOf: ["app", "feature"] } } },
              disallow: {
                to: {
                  element: {
                    type: "feature",
                    fileInternalPath: "!{index,server}.ts",
                  },
                },
              },
              message: `Import another feature only through its public API: @/features/{{to.element.captured.feature}} (client-safe) or @/features/{{to.element.captured.feature}}/server (server-only). Export what you need from there. ${DOCS}`,
            },
            {
              from: {
                element: { types: { anyOf: ["components", "hooks", "lib"] } },
              },
              disallow: {
                to: { element: { types: { anyOf: ["app", "feature"] } } },
              },
              message: `Shared code in src/{{from.element.types}} must not depend on features or routes. Move this code into the feature that needs it, or pass the data in as props/arguments. ${DOCS}`,
            },
            {
              from: { element: { type: "app" } },
              disallow: {
                to: {
                  element: { type: "lib", fileInternalPath: "supabase/**" },
                },
              },
              message: `Routes read and write data through a feature's server code (the Data Access Layer), not through Supabase clients directly. ${DOCS}`,
            },
            // The service role bypasses Row Level Security (decision 3).
            {
              from: { file: { path: notIn(["src/features/*/workflows/**"]) } },
              disallow: {
                to: {
                  element: {
                    type: "lib",
                    fileInternalPath: "supabase/admin.ts",
                  },
                },
              },
              message:
                "createAdminClient bypasses Row Level Security, so only background workflows (src/features/<feature>/workflows/) may use it (ARCHITECTURE decision 3). Handle user requests with createClient from @/lib/supabase/server.",
            },
            ...RESTRICTED_PACKAGES.map(({ source, allowedIn, message }) => ({
              from: { file: { path: notIn(allowedIn) } },
              dependency: { kind: "value" },
              disallow: { to: { module: { origin: "external", source } } },
              message,
            })),
          ],
        },
      ],
      "project/file-structure": [
        "error",
        { allowed: [...ALLOWED_FILES, TEST_FILES], docs: DOCS },
      ],
    },
  },
  {
    name: "project/next-boundaries",
    files: ["src/**/*.{ts,tsx}"],
    plugins: { project, "check-file": checkFile, "import-x": importX },
    settings: {
      // Parse TypeScript dependencies too, or cycles through them go unseen.
      "import-x/extensions":
        importX.flatConfigs.typescript.settings["import-x/extensions"],
      "import-x/parsers":
        importX.flatConfigs.typescript.settings["import-x/parsers"],
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "project/require-server-only": [
        "error",
        {
          files: ["src/features/*/server.ts", "src/features/*/server/**"],
        },
      ],
      "project/use-server-location": [
        "error",
        { allowed: ["src/features/*/server/actions.ts"] },
      ],
      "project/no-server-import-in-client": "error",
      "check-file/filename-naming-convention": [
        "error",
        { "src/**/*.{ts,tsx}": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],
      "check-file/folder-naming-convention": [
        "error",
        {
          "src/app/**/": "NEXT_JS_APP_ROUTER_CASE",
          "src/!(app)/**/": "KEBAB_CASE",
        },
      ],
      // Imports across folders use the `@/` alias, so moving a file never
      // breaks another one and every import shows which layer it targets.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message:
                "Import from another folder with the @/ alias (e.g. @/features/auth/schemas), not a ../ path.",
            },
          ],
        },
      ],
      // Public entry files list their exports, so the API stays deliberate.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message:
            "List exports by name instead of `export *`, so a module's public API stays explicit.",
        },
      ],
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
    },
  },
  {
    // Only the env modules read process.env, so every variable is validated
    // in one place and secrets stay out of feature code.
    name: "project/env",
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...ENV_FILES, TEST_FILES, "src/instrumentation.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read environment variables through a validated env module (src/lib/**/env.ts or *-env.ts) instead of process.env.",
        },
      ],
    },
  },
];
