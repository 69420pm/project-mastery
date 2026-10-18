// @vitest-environment node
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { expect, test } from "vitest";
import { config } from "./proxy";

test.each([
  ["/courses", true],
  ["/api/chat", true],
  ["/auth/confirm", true],
  // Vercel Workflow's internal routes break behind the proxy.
  ["/.well-known/workflow/v1/flow", false],
  ["/_next/static/x.js", false],
  ["/logo.png", false],
])("the proxy runs on %s: %s", (url, matches) => {
  expect(unstable_doesMiddlewareMatch({ config, url })).toBe(matches);
});
