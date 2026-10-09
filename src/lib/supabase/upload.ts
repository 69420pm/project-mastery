import { createClient } from "./client";

/** How an upload ended. */
export type UploadOutcome = "uploaded" | "cancelled" | "failed";

type UploadOptions = {
  bucket: string;
  /** Where the file goes. It must not exist yet. */
  path: string;
  file: File;
  /** Called as bytes go out, with the share sent so far, from 0 to 1. */
  onProgress?: (fraction: number) => void;
  /** Aborting it cancels the upload. */
  signal?: AbortSignal;
};

/**
 * Uploads a file from the browser straight to Storage as the signed-in
 * user, reporting progress. supabase-js uploads with `fetch`, which reports
 * no upload progress, so this asks for a signed upload URL (the bucket
 * policies apply) and sends the same multipart body as `uploadToSignedUrl`
 * with XHR. It resolves, never rejects. After "failed" or "cancelled" the
 * file may still have been stored, since the response can be lost after
 * Storage committed it: callers remove it with `removeUploadedFile`.
 */
export async function uploadFile({
  bucket,
  path,
  file,
  onProgress,
  signal,
}: UploadOptions): Promise<UploadOutcome> {
  const { data, error } = await createClient()
    .storage.from(bucket)
    .createSignedUploadUrl(path);
  if (signal?.aborted) return "cancelled";
  if (error) {
    console.error("Preparing an upload failed", error);
    return "failed";
  }

  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", data.signedUrl);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve("uploaded");
        return;
      }
      console.error(
        "Uploading a file failed",
        request.status,
        request.response,
      );
      resolve("failed");
    };
    request.onerror = () => resolve("failed");
    request.onabort = () => resolve("cancelled");
    signal?.addEventListener("abort", () => request.abort(), { once: true });

    // The file part's type becomes the object's content type.
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    request.send(body);
  });
}

/** Removes a file the browser uploaded, e.g. when it could not be used. */
export async function removeUploadedFile(
  bucket: string,
  path: string,
): Promise<void> {
  const { error } = await createClient().storage.from(bucket).remove([path]);
  if (error) console.error("Removing an uploaded file failed", error);
}
