/** The most rows the API returns per request. */
const PAGE = 1000;

/**
 * Every row of a query, page by page, so none is cut off at the row limit.
 * `page` runs the query with `.range(from, to)` and a stable `.order(...)`;
 * an error throws with `action` in its message.
 */
export async function allRows<Row>(
  action: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${action} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}
