// @vitest-environment node
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

// Lints made-up files at real paths with the project's real config, so the
// cases prove the architecture rules fire (and stay quiet) where they should.
const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, "..") });

const ARCHITECTURE_RULES = new Set([
  "boundaries/dependencies",
  "project/file-structure",
  "project/require-server-only",
  "project/use-server-location",
  "project/no-server-import-in-client",
  "check-file/filename-naming-convention",
  "check-file/folder-naming-convention",
  "no-restricted-imports",
  "no-restricted-syntax",
  "no-restricted-properties",
]);

/** The architecture rules that report on `code` placed at `filePath`. */
async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .map((message) => message.ruleId)
    .filter((ruleId) => ARCHITECTURE_RULES.has(ruleId));
}

const cases = {
  "layer boundaries": [
    {
      name: "shared components cannot import a feature",
      file: "src/components/example.tsx",
      code: 'export { LoginForms } from "@/features/auth";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "lib cannot import a feature",
      file: "src/lib/example.ts",
      code: 'export { handleTutorChat } from "@/features/tutor/server";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "a feature imports another feature through its public API",
      file: "src/features/tutor/components/example.tsx",
      code: 'export { LoginForms } from "@/features/auth";',
      expected: [],
    },
    {
      name: "a feature cannot reach into another feature's internals",
      file: "src/features/tutor/domain/example.ts",
      code: 'export { signInSchema } from "@/features/auth/schemas";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "a feature imports its own internals freely",
      file: "src/features/auth/domain/example.ts",
      code: 'export { signInSchema } from "@/features/auth/schemas";',
      expected: [],
    },
    {
      name: "a route imports a feature's server API",
      file: "src/app/api/example/route.ts",
      code: 'export { handleTutorChat as POST } from "@/features/tutor/server";',
      expected: [],
    },
    {
      name: "a route cannot reach into a feature's internals",
      file: "src/app/api/example/route.ts",
      code: 'export { handleTutorChat as POST } from "@/features/tutor/server/chat";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "a route cannot use Supabase clients directly",
      file: "src/app/example/page.tsx",
      code: 'export { createClient } from "@/lib/supabase/server";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "root files such as proxy.ts only use lib",
      file: "src/proxy.ts",
      code: 'export { LoginForms } from "@/features/auth";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "evals test a feature through its server API",
      file: "evals/example.ts",
      code: 'export { TUTOR_INSTRUCTIONS } from "@/features/tutor/server";',
      expected: [],
    },
    {
      name: "evals cannot reach into a feature's internals",
      file: "evals/example.ts",
      code: 'export { TUTOR_INSTRUCTIONS } from "@/features/tutor/ai/instructions";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "dynamic imports are checked too",
      file: "src/components/example.tsx",
      code: 'export const load = () => import("@/features/auth");',
      expected: ["boundaries/dependencies"],
    },
  ],
  "restricted modules": [
    {
      name: "the admin client is off limits outside workflows",
      file: "src/features/auth/server/example.ts",
      code: 'import "server-only";\nexport { createAdminClient } from "@/lib/supabase/admin";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "workflows may use the admin client",
      file: "src/features/workflow-example/workflows/example-job.ts",
      code: 'export { createAdminClient } from "@/lib/supabase/admin";',
      expected: [],
    },
    {
      name: "features cannot use supabase-js directly",
      file: "src/features/auth/server/example.ts",
      code: 'import "server-only";\nexport { createClient } from "@supabase/supabase-js";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "features may import Supabase types",
      file: "src/features/auth/server/example.ts",
      code: 'import "server-only";\nexport type { AuthError } from "@supabase/supabase-js";',
      expected: [],
    },
    {
      name: "routes cannot start workflows themselves",
      file: "src/app/api/example/route.ts",
      code: 'export { start } from "workflow/api";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "model providers stay in lib/ai",
      file: "src/features/tutor/ai/example.ts",
      code: 'export { google } from "@ai-sdk/google";',
      expected: ["boundaries/dependencies"],
    },
    {
      name: "the AI SDK React hooks are allowed in features",
      file: "src/features/tutor/components/example.tsx",
      code: 'export { useChat } from "@ai-sdk/react";',
      expected: [],
    },
  ],
  "file structure": [
    {
      name: "routes contain only Next.js files",
      file: "src/app/(auth)/login/login-form.tsx",
      code: "export const x = 1;",
      expected: ["project/file-structure"],
    },
    {
      name: "features have a fixed inner layout",
      file: "src/features/auth/utils/example.ts",
      code: "export const x = 1;",
      expected: ["project/file-structure"],
    },
    {
      name: "no new top-level folders",
      file: "src/utils/example.ts",
      code: "export const x = 1;",
      expected: ["project/file-structure"],
    },
    {
      name: "hooks are named use-*",
      file: "src/hooks/media-query.ts",
      code: "export const x = 1;",
      expected: ["project/file-structure"],
    },
    {
      name: "files are kebab-case",
      file: "src/components/LoginForm.tsx",
      code: "export const x = 1;",
      expected: ["check-file/filename-naming-convention"],
    },
    {
      name: "folders are kebab-case",
      file: "src/features/studyPlan/types.ts",
      code: "export const x = 1;",
      expected: ["check-file/folder-naming-convention"],
    },
    {
      name: "route folders may use Next.js conventions",
      file: "src/app/(app)/courses/[courseId]/page.tsx",
      code: "export default function Page() { return null; }",
      expected: [],
    },
  ],
  "server and client code": [
    {
      name: "feature server modules import server-only",
      file: "src/features/auth/server/example.ts",
      code: "export const x = 1;",
      expected: ["project/require-server-only"],
    },
    {
      name: "Server Action files need no server-only import",
      file: "src/features/auth/server/actions.ts",
      code: '"use server";\nexport async function act() {}',
      expected: [],
    },
    {
      name: "Server Actions live only in server/actions.ts",
      file: "src/features/auth/components/example.tsx",
      code: '"use server";\nexport async function act() {}',
      expected: ["project/use-server-location"],
    },
    {
      name: "no inline Server Actions",
      file: "src/features/auth/server/actions.ts",
      code: '"use server";\nexport async function act() {\n  const inner = async () => {\n    "use server";\n  };\n  return inner;\n}',
      expected: ["project/use-server-location"],
    },
    {
      name: "Client Components cannot import server modules",
      file: "src/features/tutor/components/example.tsx",
      code: '"use client";\nexport { handleTutorChat } from "@/features/tutor/server";\nimport "@/features/tutor/server";',
      expected: ["project/no-server-import-in-client"],
    },
    {
      name: "Client Components may import Server Actions",
      file: "src/features/auth/components/example.tsx",
      code: '"use client";\nimport { signOut } from "@/features/auth/server/actions";\nexport const action = signOut;',
      expected: [],
    },
  ],
  "imports and environment": [
    {
      name: "imports across folders use the @/ alias",
      file: "src/features/auth/components/example.tsx",
      code: 'import { signInSchema } from "../schemas";\nexport const schema = signInSchema;',
      expected: ["no-restricted-imports"],
    },
    {
      name: "no export *",
      file: "src/features/auth/types.ts",
      code: 'export * from "./schemas";',
      expected: ["no-restricted-syntax"],
    },
    {
      name: "process.env only in env modules",
      file: "src/features/auth/domain/example.ts",
      code: "export const key = process.env.SECRET;",
      expected: ["no-restricted-properties"],
    },
    {
      name: "env modules read process.env",
      file: "src/lib/example-env.ts",
      code: "export const key = process.env.SECRET;",
      expected: [],
    },
  ],
};

for (const [group, groupCases] of Object.entries(cases)) {
  describe(group, () => {
    test.each(groupCases)("$name", async ({ file, code, expected }) => {
      expect(await violations(file, code)).toEqual(expected);
    });
  });
}
