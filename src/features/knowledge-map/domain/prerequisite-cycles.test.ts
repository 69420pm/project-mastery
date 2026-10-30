import { expect, test } from "vitest";
import { acyclicLinks } from "./prerequisite-cycles";

test("drops the newest link of each cycle, self-links and links already stored", () => {
  expect(
    acyclicLinks(
      [{ from: "a", to: "b" }],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "d", to: "d" },
        { from: "c", to: "d" },
      ],
    ),
  ).toEqual([
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ]);
});
