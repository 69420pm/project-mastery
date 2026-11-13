import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { decodeSnapshot, SNAPSHOT_TABLES } from "../gold-snapshot";
import { insertRows } from "./gold-course";
import { pullCourse } from "./gold-pull";

const staging = { url: "https://staging.example", secretKey: "secret" };

/** A fake staging: rows per table, and one stored file. */
function fakeStaging(rows: Record<string, object[]>) {
  const requests: { url: string; method?: string }[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    requests.push({ url: input, method: init?.method });
    if (input.includes("/storage/v1/object/")) {
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }
    const table = /\/rest\/v1\/([a-z_]+)\?/.exec(input)?.[1] ?? "";
    return Response.json(rows[table] ?? []);
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

it("pulls every snapshot table and the Materials' files from staging", async () => {
  const { fetchFn, requests } = fakeStaging({
    courses: [{ id: "c", name: "Algebra", pairing_requested: 1 }],
    materials: [
      {
        id: "m1",
        course_id: "c",
        media_type: "application/pdf",
        storage_path: "owner/c/m1",
      },
    ],
    material_pages: [{ id: "p1", material_id: "m1" }],
    chunks: [{ id: "k1", course_id: "c", embedding: "[0.1,0.2]" }],
  });
  const dir = await mkdtemp(path.join(tmpdir(), "gold-pull-"));

  const counts = await pullCourse(staging, "c", "algebra", { fetchFn, dir });

  expect(Object.keys(counts)).toEqual(SNAPSHOT_TABLES.map((t) => t.table));
  expect(counts).toMatchObject({ materials: 1, material_pages: 1, chunks: 1 });
  const snapshot = decodeSnapshot(
    await readFile(path.join(dir, "algebra", "snapshot.json.gz")),
  );
  expect(snapshot).toMatchObject({
    courseName: "Algebra",
    pairingRequested: 1,
  });
  expect(snapshot.tables.chunks?.[0]?.embedding).toBe("[0.1,0.2]");
  expect(await readdir(path.join(dir, "algebra", "materials"))).toEqual([
    "m1.pdf",
  ]);
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});

it("stops when the Course is not on staging", async () => {
  const { fetchFn } = fakeStaging({});
  const dir = await mkdtemp(path.join(tmpdir(), "gold-pull-"));
  await expect(
    pullCourse(staging, "missing", "x", { fetchFn, dir }),
  ).rejects.toThrow("not found on staging");
});

it("names the table when inserting rows fails", async () => {
  const supabase = {
    from: () => ({
      insert: async () => ({ error: { message: "duplicate key" } }),
    }),
  };
  await expect(
    insertRows(supabase as never, "kcs", [{ id: "k1" }]),
  ).rejects.toThrow("kcs: duplicate key");
});
