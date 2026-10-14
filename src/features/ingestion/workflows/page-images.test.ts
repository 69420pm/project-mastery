// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { openPdf } = await import("./page-images");

// Its text is Helvetica, which the PDF does not embed, so pdf.js draws it from
// its own font files.
const LECTURE = path.join(__dirname, "test-files/two-page-lecture.pdf");

describe("openPdf", () => {
  test("counts pages and renders a page with its text", async () => {
    const pdf = await openPdf(new Uint8Array(await readFile(LECTURE)));

    const png = await pdf.renderPage(1);

    expect(pdf.pageCount).toBe(2);
    const { data } = await sharp(png)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const darkPixels = data.filter((value) => value < 128).length;
    expect(darkPixels).toBeGreaterThan(500);
  });
});
