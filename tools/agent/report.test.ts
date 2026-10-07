// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  clip,
  formatCompileIssue,
  reportRuntimeErrors,
  serverErrorsFromLog,
  tidySnapshot,
  type ErrorState,
} from "./report";

describe("clip", () => {
  test("keeps the first lines of long messages", () => {
    const message = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    expect(clip(message).split("\n")).toHaveLength(8);
  });

  test("cuts long single lines", () => {
    expect(clip("x".repeat(600))).toBe(`${"x".repeat(500)}…`);
  });
});

describe("formatCompileIssue", () => {
  test("prints location, plain title and code frame", () => {
    const line = formatCompileIssue({
      severity: "error",
      filePath: "[project]/src/app/page.tsx",
      title: "**Module not found**: Can't resolve `'./missing'`",
      source: { range: { start: { line: 1, column: 1 } } },
      codeFrame: '> 1 | import { nope } from "./missing";\n',
    });
    expect(line).toBe(
      `✗ compile src/app/page.tsx:1:1 Module not found: Can't resolve './missing'\n    > 1 | import { nope } from "./missing";`,
    );
  });
});

describe("reportRuntimeErrors", () => {
  const state: ErrorState = {
    sessionErrors: [
      {
        url: "/login",
        buildError: null,
        runtimeErrors: [
          {
            type: "runtime",
            errorName: "Error",
            message: "boom",
            stack: [
              {
                file: "node_modules/react/index.js",
                methodName: "x",
                line: 1,
                column: 1,
              },
              {
                file: "src/app/page.tsx",
                methodName: "Page",
                line: 2,
                column: 7,
              },
            ],
          },
          {
            type: "console",
            errorName: "Error",
            message:
              'A tree hydrated but some attributes ... -  data-__ab-ci="0"',
          },
        ],
      },
    ],
  };

  test("reports new errors with their app frames, skipping agent-browser artifacts", () => {
    const { lines, keys } = reportRuntimeErrors(state, new Set());
    expect(lines).toEqual([
      "✗ runtime /login Error: boom\n    at Page src/app/page.tsx:2:7",
    ]);
    expect(keys).toHaveLength(1);
  });

  test("summarizes errors that were reported before", () => {
    const { keys } = reportRuntimeErrors(state, new Set());
    const { lines } = reportRuntimeErrors(state, new Set(keys));
    expect(lines).toEqual([
      "✗ 1 runtime error(s) reported before are still present",
    ]);
  });
});

describe("serverErrorsFromLog", () => {
  test("keeps server errors, not forwarded browser logs or other levels", () => {
    const log = [
      { source: "Server", level: "ERROR", message: "⨯ Error: server boom" },
      {
        source: "Server",
        level: "ERROR",
        message: '[browser] "Uncaught Error"',
      },
      { source: "Browser", level: "ERROR", message: "Uncaught Error" },
      {
        source: "Server",
        level: "WARN",
        message: "⚠ Blocked cross-origin request",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .concat("not json", "")
      .join("\n");
    expect(serverErrorsFromLog(log)).toEqual(["✗ server ⨯ Error: server boom"]);
  });
});

describe("tidySnapshot", () => {
  test("drops the Dev Tools button and empty nodes on a normal page", () => {
    const snapshot = [
      "- main",
      '  - heading "Welcome" [level=1, ref=e5]',
      "  - image",
      "  - paragraph",
      '    - StaticText "Signed in."',
      "- alert",
      '- button "Open Next.js Dev Tools" [expanded=false, ref=e6]',
      "  - image",
    ].join("\n");
    expect(tidySnapshot(snapshot)).toBe(
      [
        "- main",
        '  - heading "Welcome" [level=1, ref=e5]',
        "  - paragraph",
        '    - StaticText "Signed in."',
      ].join("\n"),
    );
  });

  test("drops the error overlay but keeps the page on an error page", () => {
    const snapshot = [
      "- generic",
      "  - generic",
      "    - generic",
      '      - dialog "Console Error"',
      '        - StaticText "Encountered a script tag"',
      '    - button "Open Next.js Dev Tools" [expanded=false, ref=e9]',
      '    - button "Open issues overlay" [ref=e10]',
      '  - heading "This page couldn’t load" [level=1, ref=e6]',
      '  - button "Reload" [ref=e7]',
    ].join("\n");
    expect(tidySnapshot(snapshot)).toBe(
      [
        "- generic",
        '  - heading "This page couldn’t load" [level=1, ref=e6]',
        '  - button "Reload" [ref=e7]',
      ].join("\n"),
    );
  });
});
