import { describe, expect, test } from "vitest";
import { modelName } from "./model-name";

describe("modelName", () => {
  test("names a gateway model id without its provider", () => {
    expect(modelName("google/gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(modelName("google/gemini-2.5-flash-lite")).toBe(
      "Gemini 2.5 Flash Lite",
    );
    expect(modelName("google/gemini-3.1-pro-preview")).toBe(
      "Gemini 3.1 Pro Preview",
    );
  });

  test("keeps version prefixes readable", () => {
    expect(modelName("xiaomi/mimo-v2.6-flash")).toBe("Mimo V2.6 Flash");
  });
});
