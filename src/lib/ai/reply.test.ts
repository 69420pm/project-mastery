import { expect, test } from "vitest";
import { messageText } from "./reply";

test("joins the text parts of a message and skips other parts", () => {
  expect(
    messageText([
      { type: "step-start" },
      { type: "text", text: "The first step " },
      { type: "text", text: "is to differentiate." },
    ]),
  ).toBe("The first step is to differentiate.");
});
