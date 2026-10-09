import { StorageApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeSupabase } from "./testing";

const me = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
const bucket = "course-files";
const mine = `${me}/course-1/material-1`;
const theirs = `${other}/course-1/material-1`;

const pdf = (text: string) =>
  new File([text], "a.pdf", { type: "application/pdf" });

function setup() {
  const db = fakeSupabase({ tables: {}, userId: me });
  return { db, files: db.files, store: db.storage.from(bucket) };
}

describe("fakeSupabase Storage", () => {
  it("uploads an object into the signed-in user's folder and reports it", async () => {
    const { store, files } = setup();

    const up = await store.upload(mine, pdf("hello"), {
      contentType: "application/pdf",
    });
    expect(up.error).toBeNull();
    expect(up.data).toMatchObject({
      path: mine,
      fullPath: `${bucket}/${mine}`,
    });

    expect(files.paths(bucket)).toEqual([mine]);
    const info = await store.info(mine);
    expect(info.data).toMatchObject({
      size: 5,
      contentType: "application/pdf",
    });
  });

  it("downloads the bytes that were uploaded", async () => {
    const { store } = setup();
    await store.upload(mine, pdf("hello"), { contentType: "application/pdf" });

    const { data, error } = await store.download(mine);
    expect(error).toBeNull();
    expect(await data!.text()).toBe("hello");
  });

  it("refuses to upload into another user's folder as RLS does", async () => {
    const { store, files } = setup();

    const { data, error } = await store.upload(theirs, pdf("x"));
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(StorageApiError);
    expect(error).toMatchObject({ status: 403, statusCode: "403" });
    expect(error!.message).toMatch(/row-level security/);
    expect(files.paths(bucket)).toEqual([]);
  });

  it("refuses a bare user id with no folder, as the policy does", async () => {
    const { store } = setup();
    const { error } = await store.upload(me, pdf("x"));
    expect(error).toMatchObject({ status: 403 });
  });

  it("refuses everything when nobody is signed in", async () => {
    const db = fakeSupabase({ tables: {} });
    const { error } = await db.storage.from(bucket).upload(mine, pdf("x"));
    expect(error).toMatchObject({ status: 403 });
  });

  it("rejects a duplicate path unless upsert is set", async () => {
    const { store, files } = setup();
    await store.upload(mine, pdf("one"));

    const dup = await store.upload(mine, pdf("two"));
    expect(dup.error).toMatchObject({ status: 409 });
    expect(files.read(bucket, mine)?.size).toBe(3);

    const up = await store.upload(mine, pdf("three"), { upsert: true });
    expect(up.error).toBeNull();
    expect(files.read(bucket, mine)?.size).toBe(5);
  });

  it("hides other users' objects: download, info and signed URL say not found", async () => {
    const { store, files } = setup();
    files.seed(bucket, theirs, { body: "secret" });

    for (const result of [
      await store.download(theirs),
      await store.info(theirs),
      await store.createSignedUrl(theirs, 60),
    ]) {
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(StorageApiError);
      expect(result.error).toMatchObject({ status: 400 });
    }
  });

  it("creates a signed URL for an own object", async () => {
    const { store } = setup();
    await store.upload(mine, pdf("x"));

    const { data, error } = await store.createSignedUrl(mine, 60);
    expect(error).toBeNull();
    expect(data!.signedUrl).toContain(mine);
  });

  it("removes own objects and silently skips others', as the API does", async () => {
    const { store, files } = setup();
    await store.upload(mine, pdf("x"));
    files.seed(bucket, theirs, { body: "secret" });

    const { data, error } = await store.remove([mine, theirs]);
    expect(error).toBeNull();
    expect(data!.map((o) => o.name)).toEqual([mine]);
    expect(files.paths(bucket)).toEqual([theirs]);
  });

  it("lists only own objects in a folder", async () => {
    const { store, files } = setup();
    await store.upload(`${me}/course-1/a`, pdf("x"));
    await store.upload(`${me}/course-1/b`, pdf("x"));
    files.seed(bucket, `${other}/course-1/c`, { body: "x" });

    const mineList = await store.list(`${me}/course-1`);
    expect(mineList.data!.map((o) => o.name).sort()).toEqual(["a", "b"]);
    const theirList = await store.list(`${other}/course-1`);
    expect(theirList.data).toEqual([]);
  });

  it("keeps buckets apart", async () => {
    const { db, files } = setup();
    await db.storage.from("other-bucket").upload(mine, pdf("x"));
    expect(files.paths(bucket)).toEqual([]);
    expect(files.paths("other-bucket")).toEqual([mine]);
  });

  it("fails an operation on purpose until healed", async () => {
    const { store, files } = setup();
    files.fail("upload", { status: 500, message: "storage is down" });

    const down = await store.upload(mine, pdf("x"));
    expect(down.data).toBeNull();
    expect(down.error).toBeInstanceOf(StorageApiError);
    expect(down.error).toMatchObject({
      status: 500,
      message: "storage is down",
    });
    expect(files.paths(bucket)).toEqual([]);

    files.heal();
    expect((await store.upload(mine, pdf("x"))).error).toBeNull();
  });
});
