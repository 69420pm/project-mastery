// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readTomlPorts } from "./config";

describe("readTomlPorts", () => {
  test("reads the first port of each section", () => {
    const toml = [
      "[api]",
      "port = 54321",
      "[db]",
      "port = 54322",
      "shadow_port = 54320",
      "[db.pooler]",
      "port = 54329",
    ].join("\n");
    expect(readTomlPorts(toml)).toEqual({
      api: 54321,
      db: 54322,
      "db.pooler": 54329,
    });
  });
});
