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

it("counts lines, used exports and coupling per unit", () => {
  const { units } = computeMetrics(root, listUnits(root));
  const byName = Object.fromEntries(units.map((u) => [u.unit, u]));

  expect(byName.a).toEqual({
    unit: "a",
    files: 2,
    loc: 5,
    publicExports: 2,
    usedOutside: 1,
    fanIn: ["b"],
    fanOut: [],
  });
  expect(byName.b).toMatchObject({ loc: 3, fanIn: [], fanOut: ["a", "lib"] });
  expect(byName.lib).toMatchObject({
    publicExports: 2,
    usedOutside: 1,
    fanIn: ["b"],
  });
  expect(byName.components).toMatchObject({ files: 0, loc: 0 });
});
