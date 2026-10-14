import { randomUUID } from "node:crypto";
import { fakeStorage } from "./testing-storage";

/**
 * An in-memory stand-in for the Supabase server client in unit tests, so
 * tests check the rows a module stores instead of mocking query chains. It
 * supports the query builder calls the app uses (select, insert, update,
 * delete, eq, in, contains, lt, gt, gte, order, limit, range, single,
 * maybeSingle, and
 * `rpc` through the test's `functions`) and emulates Row Level
 * Security with `canAccess`: rows it rejects are invisible to reads, updates
 * and deletes, and inserting one fails with `42501`, as with real policies.
 * Real policies are tested with pgTAP (supabase/tests/database/).
 *
 *   const db = fakeSupabase({ tables: { chats: [] }, canAccess: (table, row) => row.owner === me });
 *   vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
 */

export type FakeRow = Record<string, unknown>;

export type FakeSupabaseOptions<Table extends string> = {
  /** The tables and their initial rows. Tests read them to check effects. */
  tables: Record<Table, FakeRow[]>;
  /** Column defaults per table, like the schema's `default` clauses. */
  defaults?: Partial<Record<Table, () => FakeRow>>;
  /**
   * Foreign keys per table, as `{ column: referenced table }` on its `id`:
   * inserting a row whose referenced row is missing fails with `23503`.
   */
  foreignKeys?: Partial<Record<NoInfer<Table>, Record<string, NoInfer<Table>>>>;
  /**
   * Primary key columns per table, for tables whose key is not `id`:
   * inserting a row with a taken key fails with `23505`.
   */
  primaryKeys?: Partial<Record<NoInfer<Table>, string[]>>;
  /**
   * Database functions that `rpc(name, args)` runs, with the tables. A test
   * defines what it needs of the real function; pgTAP tests the real one.
   * Throwing fails the call, as a raised Postgres error would.
   */
  functions?: Record<
    string,
    (
      args: Record<string, unknown>,
      tables: Record<NoInfer<Table>, FakeRow[]>,
    ) => unknown
  >;
  /** The signed-in user, whose folder in Storage the fake lets them use. */
  userId?: string;
  /** Row Level Security: whether the current user may see and write `row`. */
  canAccess?: (
    table: Table,
    row: FakeRow,
    tables: Record<Table, FakeRow[]>,
  ) => boolean;
};

type Result = {
  data: unknown;
  error: { code: string; message: string } | null;
};

const failure = (code: string, message: string): Result => ({
  data: null,
  error: { code, message },
});

/**
 * Postgres' jsonb `@>`: objects contain the keys of `value` with contained
 * values, and arrays contain each element of `value` somewhere.
 */
function jsonContains(stored: unknown, value: unknown): boolean {
  if (Array.isArray(value)) {
    return (
      Array.isArray(stored) &&
      value.every((wanted) => stored.some((item) => jsonContains(item, wanted)))
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      stored !== null &&
      typeof stored === "object" &&
      !Array.isArray(stored) &&
      Object.entries(value).every(([key, wanted]) =>
        jsonContains((stored as Record<string, unknown>)[key], wanted),
      )
    );
  }
  return stored === value;
}

export function fakeSupabase<Table extends string>(
  options: FakeSupabaseOptions<Table>,
) {
  const { tables } = options;
  // Strictly increasing timestamps, so rows keep their insertion order.
  let tick = 0;
  const timestamp = () => new Date(Date.UTC(2026, 0, 1) + tick++).toISOString();
  const rowsOf = (table: Table) => tables[table];
  const visible = (table: Table, row: FakeRow) =>
    options.canAccess?.(table, row, tables) ?? true;

  function from(table: Table) {
    type Action =
      | { kind: "select" }
      | { kind: "insert"; rows: FakeRow[] }
      | { kind: "update"; values: FakeRow }
      | { kind: "delete" };
    let action: Action = { kind: "select" };
    const filters: Array<(row: FakeRow) => boolean> = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    let returning = false;
    let single: "one" | "maybe" | undefined;
    let limitTo = Infinity;
    let offset = 0;

    const matching = () =>
      rowsOf(table).filter(
        (row) => visible(table, row) && filters.every((f) => f(row)),
      );

    function insert(rows: FakeRow[]): Result {
      const prepared = rows.map((row): FakeRow => ({
        id: randomUUID(),
        created_at: timestamp(),
        updated_at: timestamp(),
        ...options.defaults?.[table]?.(),
        ...row,
      }));
      for (const row of prepared) {
        for (const [column, referenced] of Object.entries(
          options.foreignKeys?.[table] ?? {},
        )) {
          const value = (row as FakeRow)[column];
          if (
            value != null &&
            !rowsOf(referenced as Table).some((other) => other.id === value)
          ) {
            return failure(
              "23503",
              `insert or update on table "${table}" violates foreign key constraint "${table}_${column}_fkey"`,
            );
          }
        }
        if (!visible(table, row)) {
          return failure(
            "42501",
            `new row violates row-level security policy for table "${table}"`,
          );
        }
        const key = options.primaryKeys?.[table] ?? ["id"];
        if (
          rowsOf(table).some((existing) =>
            key.every((column) => existing[column] === row[column]),
          )
        ) {
          return failure(
            "23505",
            `duplicate key value violates unique constraint "${table}_pkey"`,
          );
        }
      }
      rowsOf(table).push(...prepared);
      return { data: prepared, error: null };
    }

    function run(): Result {
      let result: Result;
      if (action.kind === "insert") {
        result = insert(action.rows);
      } else if (action.kind === "update") {
        const rows = matching();
        for (const row of rows) Object.assign(row, action.values);
        result = { data: rows, error: null };
      } else if (action.kind === "delete") {
        const rows = matching();
        tables[table] = rowsOf(table).filter((row) => !rows.includes(row));
        result = { data: rows, error: null };
      } else {
        const rows = matching().sort((a, b) => {
          for (const { column, ascending } of orders) {
            const [x, y] = [a[column], b[column]];
            // Numbers in numeric order, as Postgres sorts integer columns.
            const order =
              typeof x === "number" && typeof y === "number"
                ? x - y
                : String(x).localeCompare(String(y));
            if (order !== 0) return ascending ? order : -order;
          }
          return 0;
        });
        result = {
          data: rows.slice(offset, offset + limitTo),
          error: null,
        };
      }
      if (result.error) return result;
      const rows = result.data as FakeRow[];
      // Return copies, so callers cannot change stored rows by accident.
      const copies = rows.map((row) => structuredClone(row));
      if (single === "one") {
        return copies.length === 1
          ? { data: copies[0], error: null }
          : failure("PGRST116", `expected one row, got ${copies.length}`);
      }
      if (single === "maybe") {
        return copies.length <= 1
          ? { data: copies[0] ?? null, error: null }
          : failure(
              "PGRST116",
              `expected at most one row, got ${copies.length}`,
            );
      }
      return {
        data: action.kind === "select" || returning ? copies : null,
        error: null,
      };
    }

    const builder = {
      select() {
        if (action.kind !== "select") returning = true;
        return builder;
      },
      insert(values: FakeRow | FakeRow[]) {
        action = { kind: "insert", rows: [values].flat() };
        return builder;
      },
      update(values: FakeRow) {
        action = { kind: "update", values };
        return builder;
      },
      delete() {
        action = { kind: "delete" };
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      /** `is(column, null)`: the column has no value. */
      is(column: string, value: null) {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      /**
       * jsonb containment (`@>`) on a `jsonb` column. Like postgrest-js, a
       * string is sent as is, so pass JSON text: postgrest-js would send an
       * array as a Postgres array literal, which the fake refuses.
       */
      contains(column: string, value: string) {
        if (typeof value !== "string") {
          throw new Error("contains: pass JSON text for a jsonb column");
        }
        const wanted: unknown = JSON.parse(value);
        filters.push((row) => jsonContains(row[column], wanted));
        return builder;
      },
      lt(column: string, value: unknown) {
        filters.push((row) => String(row[column]) < String(value));
        return builder;
      },
      gt(column: string, value: unknown) {
        filters.push((row) => String(row[column]) > String(value));
        return builder;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(row[column]) >= String(value));
        return builder;
      },
      order(column: string, { ascending = true } = {}) {
        orders.push({ column, ascending });
        return builder;
      },
      limit(count: number) {
        limitTo = count;
        return builder;
      },
      /** Rows `from` to `to`, both included, as PostgREST pages them. */
      range(rangeFrom: number, rangeTo: number) {
        offset = rangeFrom;
        limitTo = rangeTo - rangeFrom + 1;
        return builder;
      },
      single() {
        single = "one";
        return builder;
      },
      maybeSingle() {
        single = "maybe";
        return builder;
      },
      then<T1 = Result, T2 = never>(
        resolve?: ((value: Result) => T1 | PromiseLike<T1>) | null,
        reject?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
      ) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return builder;
  }

  async function rpc(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Result> {
    const run = options.functions?.[name];
    if (!run) {
      return failure(
        "PGRST202",
        `Could not find the function public.${name} in the schema cache`,
      );
    }
    try {
      return { data: run(structuredClone(args), tables) ?? null, error: null };
    } catch (error) {
      return failure("P0001", (error as Error).message);
    }
  }

  return { from, rpc, tables, ...fakeStorage(options.userId) };
}
