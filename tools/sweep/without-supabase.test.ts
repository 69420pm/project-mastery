// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { withoutSupabase } from "./without-supabase";

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** A `run` that records each command, with `docker ps` printing `ps`. */
function fakeRun(ps: string) {
  return async (args: string[]) => {
    calls.push(args.join(" "));
    return { code: 0, out: args[0] === "docker" ? ps : "" };
  };
}

const work = (fails = false) =>
  vi.fn(async () => {
    calls.push("work");
    if (fails) throw new Error("work failed");
  });

const PS = "docker ps --quiet --filter name=supabase_db_";

test("runs the work alone when the stack is not running", async () => {
  await withoutSupabase(fakeRun(""), work());
  expect(calls).toEqual([PS, "work"]);
});

test("runs the work alone when docker is unavailable", async () => {
  await withoutSupabase(() => Promise.reject(new Error("no docker")), work());
  expect(calls).toEqual(["work"]);
});

test("stops the running stack and starts it after the work", async () => {
  await withoutSupabase(fakeRun("abc123\n"), work());
  expect(calls).toEqual([
    PS,
    "pnpm exec supabase stop",
    "work",
    "pnpm exec supabase start",
  ]);
});

test("starts the stack again when the work throws", async () => {
  await expect(
    withoutSupabase(fakeRun("abc123\n"), work(true)),
  ).rejects.toThrow("work failed");
  expect(calls.at(-1)).toBe("pnpm exec supabase start");
});
