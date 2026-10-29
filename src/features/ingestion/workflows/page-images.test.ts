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

// Page 3 holds only a small page number.
const BLANK = path.join(__dirname, "test-files/slides-with-blank.pdf");

describe("openPdf", () => {
  test("counts pages, reads their text layer and renders a page with its text as a 2,000-pixel JPEG", async () => {
    const pdf = await openPdf(new Uint8Array(await readFile(LECTURE)));

    const page = await pdf.renderPage(1);

    expect(pdf.pageCount).toBe(2);
    expect((await pdf.pageTexts()).every((text) => text.trim() !== "")).toBe(
      true,
    );
    expect(page.blank).toBe(false);
    const { data, info } = await sharp(page.jpeg)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.format).toBe("raw");
    expect(Math.max(info.width, info.height)).toBe(2000);
    const darkPixels = data.filter((value) => value < 128).length;
    expect(darkPixels).toBeGreaterThan(500);
  });

  test("a page with only a page number renders blank, a page with a word does not", async () => {
    const pdf = await openPdf(new Uint8Array(await readFile(BLANK)));

    expect((await pdf.renderPage(3)).blank).toBe(true);
    expect((await pdf.renderPage(1)).blank).toBe(false);
  });
});
