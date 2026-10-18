import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { computeMetrics } from "./metrics";
import { listUnits } from "./units";

const root = mkdtempSync(path.join(os.tmpdir(), "sweep-metrics-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      moduleResolution: "bundler",
      paths: { "@/*": ["./src/*"] },
    },
  }),
);
write(
  "src/features/a/index.ts",
  'export { helper } from "./domain/helper";\nexport const unused = 1;\n',
);
write(
  "src/features/a/domain/helper.ts",
  "// A comment.\n\n/**\n * Docs.\n */\nexport function helper() {\n  return 1;\n}\n",
);
write("src/features/a/domain/helper.test.ts", "export const x = 1;\n");
write(
  "src/features/b/index.ts",
  'import { helper } from "@/features/a";\nimport { cn } from "@/lib/cn";\n\nexport const b = helper() + cn();\n',
);
write("src/lib/cn.ts", "export const cn = () => 1;\nexport const other = 2;\n");
write("src/components/ui/button.tsx", "export const Button = 1;\n");

const metrics = () => {
  const { units } = computeMetrics(root, listUnits(root));
  return Object.fromEntries(units.map((u) => [u.unit, u]));
};

it("counts source files per unit, without tests", () => {
  const byName = metrics();
  expect(byName.a!.files).toBe(2);
  expect(byName.components!.files).toBe(0);
});

it("counts lines of code, without comments or blank lines", () => {
  const byName = metrics();
  expect(byName.a!.loc).toBe(5);
  expect(byName.b!.loc).toBe(3);
  expect(byName.components!.loc).toBe(0);
});

it("counts public exports", () => {
  const byName = metrics();
  expect(byName.a!.publicExports).toBe(2);
  expect(byName.lib!.publicExports).toBe(2);
});

it("counts the exports used outside the unit", () => {
  const byName = metrics();
  expect(byName.a!.usedOutside).toBe(1);
  expect(byName.lib!.usedOutside).toBe(1);
});

it("lists the units that import each unit", () => {
  const byName = metrics();
  expect(byName.a!.fanIn).toEqual(["b"]);
  expect(byName.b!.fanIn).toEqual([]);
  expect(byName.lib!.fanIn).toEqual(["b"]);
});

it("lists the units each unit imports", () => {
  const byName = metrics();
  expect(byName.a!.fanOut).toEqual([]);
  expect(byName.b!.fanOut).toEqual(["a", "lib"]);
});
