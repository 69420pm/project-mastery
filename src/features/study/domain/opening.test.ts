import { describe, expect, test } from "vitest";
import { openingLine } from "./opening";

describe("openingLine", () => {
  test("names the due reviews, none due, or the missing map", () => {
    expect(openingLine(true, 3)).toBe(
      "3 reviews due, then something new. Or ask about anything.",
    );
    expect(openingLine(true, 1)).toContain("1 review due");
    expect(openingLine(true, 0)).toBe(
      "Nothing due: let's learn something new. Or ask about anything.",
    );
    expect(openingLine(false, 0)).toContain("Build your Knowledge map");
  });
});
