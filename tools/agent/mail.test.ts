// @vitest-environment node
import { describe, expect, test } from "vitest";
import { extractLinks, formatMail } from "./mail";

describe("mail", () => {
  const message = {
    Subject: "Confirm your email ",
    Date: "2026-10-07T07:44:22Z",
    To: [{ Address: "student@example.com" }],
    Text: "Follow this link:\n\nConfirm (http://localhost:3000/auth/confirm?token_hash=abc&type=email)\nhttp://localhost:3000/auth/confirm?token_hash=abc&type=email",
  };

  test("extracts each link once, without surrounding punctuation", () => {
    expect(extractLinks(message.Text)).toEqual([
      "http://localhost:3000/auth/confirm?token_hash=abc&type=email",
    ]);
  });

  test("prints subject, recipient and links", () => {
    expect(formatMail(message)).toBe(
      "Confirm your email · to student@example.com · 2026-10-07T07:44:22Z\nhttp://localhost:3000/auth/confirm?token_hash=abc&type=email",
    );
  });
});
