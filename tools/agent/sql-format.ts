type Result = Record<string, unknown>[] & { command?: string; count?: number };

const MAX_ROWS = 50;

/**
 * Query results as one JSON object per row, which is compact and unambiguous
 * for an agent to read. Statements without rows print their command tag.
 */
export function formatSqlResult(
  result: Result | Result[],
  { all = false } = {},
): string {
  // A multi-statement query returns one result per statement.
  if (result.length > 0 && Array.isArray(result[0])) {
    return (result as Result[])
      .map((part) => formatSqlResult(part, { all }))
      .join("\n");
  }
  const rows = result as Result;
  if (rows.length === 0) {
    return rows.command === "SELECT" || rows.command === undefined
      ? "(0 rows)"
      : `${rows.command} ${rows.count ?? 0}`;
  }
  const shown = all ? rows : rows.slice(0, MAX_ROWS);
  const lines = shown.map((row) => JSON.stringify(row));
  const more = rows.length - shown.length;
  lines.push(
    more > 0
      ? `(${rows.length} rows, ${more} not shown: add --all)`
      : `(${rows.length} rows)`,
  );
  return lines.join("\n");
}
