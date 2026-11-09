import { expect, test } from "vitest";
import { kcBand, recallBand } from "./recall-band";
import { UNTAUGHT, type KcRecall } from "./replay";

const taught = (recallToday: number): KcRecall => ({
  ...UNTAUGHT,
  taught: true,
  recallToday,
  nextReview: "2026-10-20",
});

test.each([
  [undefined, "new"],
  [UNTAUGHT, "new"],
  [taught(0.9), "strong"],
  [taught(0.89), "fading"],
  [taught(0.7), "fading"],
  [taught(0.69), "weak"],
] as const)("recall %o at retention 0.9 is %s", (recall, band) => {
  expect(recallBand(recall, 0.9)).toBe(band);
});

test("the goal's retention sets where strong starts", () => {
  expect(recallBand(taught(0.86), 0.85)).toBe("strong");
  expect(recallBand(taught(0.86), 0.93)).toBe("fading");
});

test("a KC's band comes with its recall today and next review, none untaught", () => {
  expect(kcBand(taught(0.8), 0.9)).toEqual({
    band: "fading",
    recallToday: 0.8,
    nextReview: "2026-10-20",
  });
  expect(kcBand(undefined, 0.9)).toEqual({
    band: "new",
    recallToday: null,
    nextReview: null,
  });
});
