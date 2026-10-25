// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import {
  MAX_PROGRAM_LENGTH,
  mathRunner,
} from "@/features/study/server/math-runner";

vi.mock("server-only", () => ({}));

const run = mathRunner.run;

const thrust = `mass_flow = 40 kg/s
v_exit = 600 m/s
v_flight = 250 m/s
thrust = mass_flow * (v_exit - v_flight)
thrust_kN = to(thrust, kN)`;

describe("mathRunner", () => {
  test("returns every assigned variable and the declared answers", async () => {
    const result = await run(thrust, [{ variable: "thrust", unit: "kN" }]);
    expect(result).toMatchObject({
      ok: true,
      values: {
        mass_flow: { value: 40, unit: "kg / s" },
        thrust_kN: { value: 14, unit: "kN", text: "14 kN" },
      },
      answers: [{ variable: "thrust", unit: "kN", value: 14 }],
    });
  });

  test("fails a program that throws", async () => {
    await expect(run("a = 2 +")).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("The program failed"),
    });
  });

  test("fails a program over the time limit", async () => {
    await expect(
      run("total = sum(map(range(1, 3e6), f(x) = sum(range(1, 20))))"),
    ).resolves.toEqual({
      ok: false,
      error: "The program ran longer than 2 s and was stopped.",
    });
  });

  // Whether the heap or the time limit stops it first depends on the machine.
  test("fails a program that runs out of memory, and only it", async () => {
    await expect(run("total = sum(range(1, 1e8))")).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/out of memory|ran longer than 2 s/),
    });
    expect((await run(thrust)).ok).toBe(true);
  });

  test("fails a program over the length cap", async () => {
    const result = await run(`x = ${"1+".repeat(MAX_PROGRAM_LENGTH)}1`);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("more than the 4000 allowed"),
    });
  });

  // The note's first case: `m` shadows the metre.
  test("fails a program that assigns to a unit name", async () => {
    const result = await run("m = 2.5 kg/s\nv = 300 m/s\nF = m * v");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "mathjs units, which they would shadow: m",
      ),
    });
  });

  test("passes a function whose parameter is named like a unit", async () => {
    const result = await run("f(m) = m^2\nsquare = f(3)");
    expect(result).toMatchObject({
      ok: true,
      values: { square: { value: 9 } },
    });
  });

  // The note's second case: dividing by a unit drops it.
  test("fails a final answer that is no quantity in its declared unit", async () => {
    const result = await run(
      "thrust_newton = 22000 N\nthrust_kn = thrust_newton / 1000 N",
      [{ variable: "thrust_kn", unit: "kN" }],
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("thrust_kn = 22 is no quantity in kN"),
    });
  });

  test("fails a final answer in another dimension, or with a unit declared plain", async () => {
    const source = "speed = 3 m/s";
    for (const unit of ["kN", null, "parsecs_per_fortnight"]) {
      const result = await run(source, [{ variable: "speed", unit }]);
      expect(result.ok, String(unit)).toBe(false);
    }
    expect((await run(source, [{ variable: "missing", unit: null }])).ok).toBe(
      false,
    );
  });

  test("fails a non-finite value", async () => {
    const result = await run("zero = 0\nratio = 1 / zero");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("ratio = Infinity"),
    });
  });

  test("fails a non-finite value inside a matrix or a complex number", async () => {
    for (const program of [
      "x = [1, 1/0]",
      "x = [[1], [0/0]]",
      "x = 1/0 + 2i",
    ]) {
      const result = await run(program);
      expect(result, program).toMatchObject({
        ok: false,
        error: expect.stringContaining("not finite: x ="),
      });
    }
  });
});
