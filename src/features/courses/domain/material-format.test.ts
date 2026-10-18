import { describe, expect, test } from "vitest";
import { formatFileSize, materialTypeLabel } from "./material-format";

describe("materialTypeLabel", () => {
  test.each([
    ["application/pdf", "PDF"],
    ["image/png", "PNG"],
    ["image/jpeg", "JPEG"],
    ["image/webp", "WebP"],
    ["text/plain", "text/plain"],
  ])("labels %s as %s", (mediaType, label) => {
    expect(materialTypeLabel(mediaType)).toBe(label);
  });
});

describe("formatFileSize", () => {
  test.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1535, "1 KB"],
    [1536, "2 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1.0 MB"],
    [1.25 * 1024 * 1024, "1.3 MB"],
    [20 * 1024 * 1024, "20.0 MB"],
  ])("shows %d bytes as %s", (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});
