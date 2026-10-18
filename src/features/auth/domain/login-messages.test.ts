import { expect, test } from "vitest";
import { getLoginMessage } from "./login-messages";

test("gives the message for a known code", () => {
  expect(getLoginMessage("signed-out")).toBe("You are signed out.");
  expect(getLoginMessage("rate-limited")).toBe(
    "Too many attempts. Wait a moment and try again.",
  );
});

test.each([
  ["an unknown code", "You have won a prize"],
  ["an inherited key", "constructor"],
  ["the prototype key", "__proto__"],
  ["a repeated parameter", ["signed-out", "signed-out"]],
  ["no parameter", undefined],
])("gives null for %s", (_, code) => {
  expect(getLoginMessage(code)).toBeNull();
});
