import { expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  kcColor,
  legendEntries,
  parseSettings,
  priorityFractions,
  sizeScale,
} from "./encodings";
import { STATE_NAMES, TYPE_NAMES } from "./kc-labels";

const priority = (level: "high" | "excluded", value: number) => ({
  level,
  value,
  reasons: [],
});

test("Priority fractions run from the lowest to the highest value and skip excluded KCs", () => {
  const fractions = priorityFractions({
    a: priority("high", 2),
    b: priority("high", 6),
    c: priority("high", 4),
    d: priority("excluded", 100),
  });
  expect(Object.fromEntries(fractions)).toEqual({ a: 0, b: 1, c: 0.5 });
  expect(priorityFractions({}).size).toBe(0);
  expect(priorityFractions({ a: priority("high", 3) }).get("a")).toBe(1);
});

test("size scale shrinks a KC to 70% at the lowest Priority and none at all", () => {
  expect(sizeScale(1)).toBe(1);
  expect(sizeScale(0)).toBeCloseTo(0.7);
  expect(sizeScale(undefined)).toBeCloseTo(0.7);
});

test("colours follow the chosen attribute", () => {
  const kc = {
    state: "due" as const,
    type: "fact" as const,
    bigIdeaId: "b2",
    fraction: 1,
  };
  const bigIdeas = new Map([["b2", "red"]]);
  expect(kcColor("state", kc, bigIdeas)).toBe("var(--warning)");
  expect(kcColor("priority", kc, bigIdeas)).toBe("var(--chart-5)");
  expect(kcColor("priority", { ...kc, fraction: 0 }, bigIdeas)).toBe(
    "var(--chart-1)",
  );
  expect(kcColor("priority", { ...kc, fraction: undefined }, bigIdeas)).toBe(
    "var(--muted-foreground)",
  );
  expect(kcColor("bigIdea", kc, bigIdeas)).toBe("red");
  expect(kcColor("bigIdea", { ...kc, bigIdeaId: "gone" }, bigIdeas)).toBe(
    "var(--muted-foreground)",
  );
});

test("the legend lists one entry per Big idea", () => {
  const entries = legendEntries(
    "bigIdea",
    [
      { id: "1", name: "Forces" },
      { id: "2", name: "Energy" },
    ],
    TYPE_NAMES,
    STATE_NAMES,
  );
  expect(entries.map((e) => e.label)).toEqual(["Forces", "Energy"]);
  expect(legendEntries("state", [], TYPE_NAMES, STATE_NAMES)).toHaveLength(4);
});

test("saved settings fall back to the defaults when missing or invalid", () => {
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings('"text"')).toEqual(DEFAULT_SETTINGS);
  const parsed = parseSettings(
    JSON.stringify({
      colorBy: "nonsense",
      sizeByPriority: true,
      layers: { exercises: false },
    }),
  );
  expect(parsed.colorBy).toBe("state");
  expect(parsed.sizeByPriority).toBe(true);
  expect(parsed.layers.exercises).toBe(false);
  expect(parsed.layers.prerequisites).toBe(true);
});

test("a malformed saved `layers` falls back key by key", () => {
  const layers = (value: unknown) =>
    parseSettings(JSON.stringify({ colorBy: "bigIdea", layers: value }));
  for (const value of ["all", null, [], 1]) {
    expect(layers(value)).toEqual({ ...DEFAULT_SETTINGS, colorBy: "bigIdea" });
  }
  const parsed = layers({
    exercises: "false",
    prerequisites: 0,
    bigIdeaGroups: false,
  });
  expect(parsed.layers).toEqual({
    ...DEFAULT_SETTINGS.layers,
    bigIdeaGroups: false,
  });
});
