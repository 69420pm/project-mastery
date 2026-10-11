import { describe, expect, test } from "vitest";
import { missingPages } from "./missing-pages";

describe("missingPages", () => {
  test("is every page when none is stored", () => {
    expect(missingPages(3, [])).toEqual([1, 2, 3]);
  });

  test("leaves out the pages with a stored result, in page order", () => {
    expect(missingPages(5, [4, 1, 2])).toEqual([3, 5]);
  });

  test("is empty when every page is stored", () => {
    expect(missingPages(2, [2, 1])).toEqual([]);
  });

  test("ignores stored pages beyond the page count", () => {
    expect(missingPages(2, [3])).toEqual([1, 2]);
  });
});
