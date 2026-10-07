// @vitest-environment node
import { describe, expect, test } from "vitest";
import { formatSqlResult } from "./sql-format";

describe("formatSqlResult", () => {
  const result = (
    rows: Record<string, unknown>[],
    command: string,
    count = rows.length,
  ) => Object.assign(rows, { command, count });

  test("prints rows as JSON lines with a count", () => {
    expect(formatSqlResult(result([{ id: 1 }, { id: 2 }], "SELECT"))).toBe(
      '{"id":1}\n{"id":2}\n(2 rows)',
    );
  });

  test("prints the command tag for statements without rows", () => {
    expect(formatSqlResult(result([], "UPDATE", 3))).toBe("UPDATE 3");
    expect(formatSqlResult(result([], "SELECT"))).toBe("(0 rows)");
  });

  test("limits long results unless all rows are asked for", () => {
    const rows = Array.from({ length: 60 }, (_, id) => ({ id }));
    expect(formatSqlResult(result(rows, "SELECT")).split("\n").at(-1)).toBe(
      "(60 rows, 10 not shown: add --all)",
    );
    expect(
      formatSqlResult(result(rows, "SELECT"), { all: true }).split("\n"),
    ).toHaveLength(61);
  });

  test("prints one block per statement", () => {
    expect(
      formatSqlResult([result([{ a: 1 }], "SELECT"), result([], "DELETE", 1)]),
    ).toBe('{"a":1}\n(1 rows)\nDELETE 1');
  });
});
