import { StorageApiError } from "@supabase/supabase-js";

/**
 * The in-memory Storage of `fakeSupabase`. It mirrors the `course-files`
 * policies: the signed-in user (`userId`) may list, read, upload, replace and
 * delete only objects under their own `<user id>/` folder. Objects outside it
 * are invisible, as with real RLS, so reads say "not found" and writes fail
 * with 403. Operations resolve `{ data, error }` and never throw, like
 * supabase-js.
 */

export type StorageOperation =
  "upload" | "download" | "remove" | "list" | "info" | "createSignedUrl";

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
  createdAt: string;
  id: string;
};

type Body = File | Blob | ArrayBuffer | Uint8Array | string;

export type SeedOptions = { body: Body; contentType?: string };

const notFound = () => new StorageApiError("Object not found", 400, "404");
const denied = () =>
  new StorageApiError("new row violates row-level security policy", 403, "403");

async function toBytes(body: Body): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  return new Uint8Array(await body.arrayBuffer());
}

export function fakeStorage(userId: string | undefined) {
  const buckets = new Map<string, Map<string, StoredObject>>();
  const failures = new Map<StorageOperation, StorageApiError>();
  let counter = 0;

  const bucketOf = (name: string) => {
    let bucket = buckets.get(name);
    if (!bucket) buckets.set(name, (bucket = new Map()));
    return bucket;
  };
  // Like `storage.foldername(name)[1]`: a bare `<user id>` has no folder.
  const owns = (path: string) => {
    const segments = path.split("/");
    return (
      userId !== undefined && segments.length >= 2 && segments[0] === userId
    );
  };
  const make = (bytes: Uint8Array, contentType: string): StoredObject => ({
    bytes,
    contentType,
    createdAt: new Date(Date.UTC(2026, 0, 1) + counter).toISOString(),
    id: `object-${counter++}`,
  });

  /** Test handle: seed, inspect and break storage. */
  const files = {
    /** Stores an object without any policy check, for any owner. */
    seed(bucket: string, path: string, { body, contentType }: SeedOptions) {
      // Seeding is synchronous, so convert the common bodies right away.
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : body instanceof Uint8Array
            ? new Uint8Array(body)
            : body instanceof ArrayBuffer
              ? new Uint8Array(body.slice(0))
              : undefined;
      if (!bytes)
        throw new Error("seed: pass a string, Uint8Array or ArrayBuffer");
      bucketOf(bucket).set(
        path,
        make(bytes, contentType ?? "application/octet-stream"),
      );
    },
    /** What is stored at `path`, whoever owns it. */
    read(bucket: string, path: string) {
      const object = buckets.get(bucket)?.get(path);
      return (
        object && {
          size: object.bytes.byteLength,
          contentType: object.contentType,
          text: new TextDecoder().decode(object.bytes),
        }
      );
    },
    /** Every stored path in a bucket, whoever owns it. */
    paths(bucket: string) {
      return [...(buckets.get(bucket)?.keys() ?? [])];
    },
    /** Makes every later call of `operation` fail until `heal()`. */
    fail(
      operation: StorageOperation,
      { status = 500, message = "Storage failure" } = {},
    ) {
      failures.set(
        operation,
        new StorageApiError(message, status, String(status)),
      );
    },
    heal() {
      failures.clear();
    },
  };

  function from(bucketName: string) {
    const bucket = bucketOf(bucketName);

    async function guarded<T>(
      operation: StorageOperation,
      run: () => Promise<T | StorageApiError> | T | StorageApiError,
    ): Promise<
      { data: T; error: null } | { data: null; error: StorageApiError }
    > {
      const failure = failures.get(operation);
      if (failure) return { data: null, error: failure };
      const result = await run();
      return result instanceof StorageApiError
        ? { data: null, error: result }
        : { data: result, error: null };
    }

    const visible = (path: string) => owns(path) && bucket.has(path);

    return {
      upload(
        path: string,
        body: Body,
        options: { contentType?: string; upsert?: boolean } = {},
      ) {
        return guarded("upload", async () => {
          if (!owns(path)) return denied();
          if (bucket.has(path) && !options.upsert) {
            return new StorageApiError(
              "The resource already exists",
              409,
              "409",
            );
          }
          const contentType =
            options.contentType ||
            (body instanceof Blob && body.type) ||
            "text/plain;charset=UTF-8";
          bucket.set(path, make(await toBytes(body), contentType));
          return {
            id: bucket.get(path)!.id,
            path,
            fullPath: `${bucketName}/${path}`,
          };
        });
      },
      download(path: string) {
        return guarded("download", () => {
          const object = visible(path) && bucket.get(path);
          if (!object) return notFound();
          return new Blob([object.bytes as BlobPart], {
            type: object.contentType,
          });
        });
      },
      info(path: string) {
        return guarded("info", () => {
          const object = visible(path) && bucket.get(path);
          if (!object) return notFound();
          return {
            id: object.id,
            name: path,
            size: object.bytes.byteLength,
            contentType: object.contentType,
            createdAt: object.createdAt,
            lastModified: object.createdAt,
            metadata: {},
          };
        });
      },
      createSignedUrl(path: string, expiresIn: number) {
        return guarded("createSignedUrl", () => {
          if (!visible(path)) return notFound();
          return {
            signedUrl: `http://storage.fake/object/sign/${bucketName}/${path}?token=fake&expiresIn=${expiresIn}`,
          };
        });
      },
      remove(paths: string[]) {
        return guarded("remove", () => {
          const removed = paths.filter(visible);
          for (const path of removed) bucket.delete(path);
          return removed.map((name) => ({ name, bucket_id: bucketName }));
        });
      },
      list(folder = "") {
        return guarded("list", () => {
          const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
          return [...bucket]
            .filter(([path]) => owns(path) && path.startsWith(prefix))
            .map(([path, object]) => ({
              name: path.slice(prefix.length),
              id: object.id,
              created_at: object.createdAt,
              metadata: {
                size: object.bytes.byteLength,
                mimetype: object.contentType,
              },
            }))
            .filter((entry) => !entry.name.includes("/"));
        });
      },
    };
  }

  return { storage: { from }, files };
}
