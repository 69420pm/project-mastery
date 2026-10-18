import { APICallError } from "ai";
import { expect, test } from "vitest";
import { retryDelayMs } from "./retry-delay";

const error = (
  responseHeaders?: Record<string, string>,
  responseBody?: string,
) =>
  new APICallError({
    message: "Too many requests",
    url: "https://example.com",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders,
    responseBody,
  });

const googleBody = (retryDelay: string, type = "google.rpc.RetryInfo") =>
  JSON.stringify({
    error: {
      details: [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo" },
        { "@type": `type.googleapis.com/${type}`, retryDelay },
      ],
    },
  });

test.each([
  ["retry-after-ms", error({ "retry-after-ms": "1500" }), 1500],
  ["retry-after in seconds", error({ "retry-after": "2" }), 2000],
  [
    "retry-after-ms before retry-after",
    error({ "retry-after-ms": "300", "retry-after": "9" }),
    300,
  ],
  [
    "retry-after when retry-after-ms is unreadable",
    error({ "retry-after-ms": "soon", "retry-after": "3" }),
    3000,
  ],
  ["a zero header", error({ "retry-after": "0" }), 0],
  [
    "the headers before the body",
    error({ "retry-after": "1" }, googleBody("21s")),
    1000,
  ],
  ["the Google body form", error({}, googleBody("21s")), 21_000],
  ["a fractional Google delay", error(undefined, googleBody("0.5s")), 500],
  ["no hint", error(), undefined],
  ["a negative header", error({ "retry-after": "-1" }), undefined],
  ["a body that is no JSON", error({}, "Rate limited"), undefined],
  [
    "a body without RetryInfo",
    error({}, googleBody("21s", "google.rpc.Help")),
    undefined,
  ],
])("reads %s", (_case, apiError, delay) => {
  expect(retryDelayMs(apiError)).toBe(delay);
});
