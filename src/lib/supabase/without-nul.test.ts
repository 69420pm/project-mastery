// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWithoutNul, withoutNul } from "./without-nul";

describe("withoutNul", () => {
  test("drops NUL escapes anywhere in the JSON text", () => {
    const body = JSON.stringify({
      units: [{ markdown: "Grenz\u0000wert" }, { markdown: "\u0000a\u0000" }],
    });

    expect(JSON.parse(withoutNul(body))).toEqual({
      units: [{ markdown: "Grenzwert" }, { markdown: "a" }],
    });
  });

  test("keeps the text u0000 behind a backslash, which is no NUL", () => {
    const body = JSON.stringify({
      a: "\\u0000",
      b: "\\\\u0000",
      c: "x\\\u0000",
    });

    expect(JSON.parse(withoutNul(body))).toEqual({
      a: "\\u0000",
      b: "\\\\u0000",
      c: "x\\",
    });
  });

  test("leaves a body without NUL as it is", () => {
    const body = JSON.stringify({ markdown: "$\\lim a_n$ ü" });

    expect(withoutNul(body)).toBe(body);
  });
});

describe("fetchWithoutNul", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sent = async (init: RequestInit) => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithoutNul("http://db.test/rest/v1/x", init);
    return (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  };

  test("cleans a JSON body and keeps the rest of the request", async () => {
    const init = await sent({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "a\u0000b" }),
    });

    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"markdown":"ab"}');
  });

  test("leaves other bodies, such as an uploaded text file, untouched", async () => {
    const body = JSON.stringify({ markdown: "a\u0000b" });

    const init = await sent({
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });

    expect(init.body).toBe(body);
  });
});
