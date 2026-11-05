import { describe, expect, it } from "vitest";
import { AgentError } from "./config";
import { checkReadQuery, stagingDatabaseUrl } from "./staging";

describe("checkReadQuery", () => {
  it.each([
    "select count(*) from materials",
    "  SELECT id FROM profiles LIMIT 3;  ",
    "with x as (select 1) select * from x",
    "table materials",
    "show search_path",
    "explain select 1",
  ])("accepts %j", (query) => {
    expect(() => checkReadQuery(query)).not.toThrow();
  });

  it.each([
    "insert into materials default values",
    "update materials set title = 'x'",
    "delete from materials",
    "drop table materials",
    "commit",
    "set role postgres",
    "select 1; delete from materials",
    "select 1;; select 2",
    "",
  ])("refuses %j", (query) => {
    expect(() => checkReadQuery(query)).toThrow(AgentError);
  });
});

describe("stagingDatabaseUrl", () => {
  it("returns the connection string", () => {
    const url =
      "postgresql://agent_reader.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    expect(stagingDatabaseUrl({ STAGING_DATABASE_URL: url })).toBe(url);
  });

  it("says what is missing", () => {
    expect(() => stagingDatabaseUrl({})).toThrow(/STAGING_DATABASE_URL/);
  });

  it("refuses a value that is not a Postgres connection string", () => {
    expect(() =>
      stagingDatabaseUrl({ STAGING_DATABASE_URL: "https://abc.supabase.co" }),
    ).toThrow(AgentError);
  });
});
