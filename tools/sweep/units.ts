/**
 * The units /sweep audits one by one. This is the only definition: `pnpm -s
 * sweep` prints the list.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type Unit = {
  name: string;
  /** Folders and files of the unit, relative to the repo root. */
  paths: string[];
  /** Folders whose .ts files `sweep mutate` mutates: no React components. */
  mutate: string[];
};

/** Generated code, tests and test helpers, left out of every check. */
export function isExcluded(file: string): boolean {
  return (
    /(\.test|\.spec|-testing)\.(tsx?|mjs)$/.test(file) ||
    file.startsWith("src/components/ui/") ||
    file.startsWith("src/components/ai-elements/") ||
    file.endsWith("database.types.ts") ||
    file.startsWith("supabase/tests/")
  );
}

/**
 * Each feature, then lib, components, hooks, app, supabase, and tools with
 * evals, e2e and the ESLint rules.
 */
export function listUnits(root: string): Unit[] {
  const features = readdirSync(path.join(root, "src/features"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return [
    ...features.map((name) => ({
      name,
      paths: [`src/features/${name}`],
      mutate: ["domain", "server", "ai", "workflows"].map(
        (folder) => `src/features/${name}/${folder}`,
      ),
    })),
    { name: "lib", paths: ["src/lib"], mutate: ["src/lib"] },
    { name: "components", paths: ["src/components"], mutate: [] },
    { name: "hooks", paths: ["src/hooks"], mutate: [] },
    {
      name: "app",
      paths: ["src/app", "src/proxy.ts", "src/instrumentation.ts"],
      mutate: [],
    },
    { name: "supabase", paths: ["supabase"], mutate: [] },
    {
      name: "tools",
      paths: ["tools", "evals", "e2e", "eslint"],
      mutate: [],
    },
  ];
}

/** The unit a repo-relative file belongs to, if any. */
export function unitOf(units: Unit[], file: string): Unit | undefined {
  return units.find((unit) =>
    unit.paths.some((p) => file === p || file.startsWith(`${p}/`)),
  );
}

const CODE = /\.(ts|tsx|mts|mjs|sql)$/;

/** Repo-relative code files under a folder, or the file itself. */
export function listFiles(root: string, rel: string): string[] {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return CODE.test(rel) ? [rel] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) =>
    entry.name.startsWith(".") || entry.name === "node_modules"
      ? []
      : listFiles(root, `${rel}/${entry.name}`),
  );
}
