import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const storage = {
  createSignedUploadUrl: vi.fn(),
  remove: vi.fn(),
};
vi.mock("./client", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

const { removeUploadedFile, uploadFile } = await import("./upload");

/** The last XHR the upload opened; the test plays the network's part. */
let xhr: FakeXhr;

class FakeXhr {
  status = 0;
  response = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent = false;
  upload: { onprogress?: (event: Partial<ProgressEvent>) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the request
    xhr = this;
  }
  open(method: string, url: string) {
    [this.method, this.url] = [method, url];
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const file = new File(["notes"], "notes.pdf", { type: "application/pdf" });
const options = { bucket: "materials", path: "user/notes.pdf", file };

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  xhr = new FakeXhr(); // An unsent one, until the upload opens its own.
  vi.spyOn(console, "error").mockImplementation(() => {});
  storage.createSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: "http://storage.test/upload?token=t" },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Starts an upload and waits until its request is sent. */
async function start(extra: { signal?: AbortSignal } = {}) {
  const onProgress = vi.fn();
  const outcome = uploadFile({ ...options, ...extra, onProgress });
  await vi.waitFor(() => expect(xhr.sent).toBe(true));
  return { outcome, onProgress };
}

describe("uploadFile", () => {
  test("PUTs to the signed URL without overwriting, reporting progress", async () => {
    const { outcome, onProgress } = await start();

    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
      "user/notes.pdf",
    );
    expect([xhr.method, xhr.url]).toEqual([
      "PUT",
      "http://storage.test/upload?token=t",
    ]);
    expect(xhr.headers["x-upsert"]).toBe("false");
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    expect(onProgress.mock.calls).toEqual([[0.25]]);
    xhr.respond(200);
    await expect(outcome).resolves.toBe("uploaded");
  });

  test.each([400, 500])("fails on status %i", async (status) => {
    const { outcome } = await start();
    xhr.respond(status);
    await expect(outcome).resolves.toBe("failed");
  });

  test("fails on a network error", async () => {
    const { outcome } = await start();
    xhr.onerror?.();
    await expect(outcome).resolves.toBe("failed");
  });

  test("fails when the signed URL cannot be made", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: new Error("denied"),
    });
    await expect(uploadFile(options)).resolves.toBe("failed");
  });

  test("is cancelled when aborted before the request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFile({ ...options, signal: controller.signal }),
    ).resolves.toBe("cancelled");
  });

  test("is cancelled when aborted during the request", async () => {
    const controller = new AbortController();
    const { outcome } = await start({ signal: controller.signal });
    controller.abort();
    await expect(outcome).resolves.toBe("cancelled");
  });
});

describe("removeUploadedFile", () => {
  test("removes the file", async () => {
    storage.remove.mockResolvedValue({ data: [], error: null });
    await removeUploadedFile("materials", "user/notes.pdf");
    expect(storage.remove).toHaveBeenCalledWith(["user/notes.pdf"]);
  });

  test("resolves when Storage errors", async () => {
    storage.remove.mockResolvedValue({ data: null, error: new Error("gone") });
    await expect(
      removeUploadedFile("materials", "user/notes.pdf"),
    ).resolves.toBeUndefined();
  });
});
