# mathjs as the math runner

Verified on 2026-10-25 with the installed `mathjs` (15.x) under Node, for M5b (#183).

- `math.evaluate(program, scope)` takes a multi-line program, one assignment per line, and leaves every assigned variable in `scope` (a `Map` works). Units work inline: `mass_air_flow = 40 kg/s`.
- **A variable named like a unit shadows it.** After `m = 2.5 kg/s`, the line `v = 300 m/s` reads `m` as the variable, not the metre, and `to(F, kN)` then throws `Units do not match ('kN' != '1875 kg^2 / s^3')`. Refuse programs that assign to a unit name.
- **Dividing by a unit drops it.** MiMo wrote `thrust_kn = thrust_newton / 1000 N`, which is the bare number `22`, while declaring the unit `kN`. A final answer declared with a unit must evaluate to a unit quantity convertible to it.
- `import(...)` is undefined in the expression language, and the parser has no access to JavaScript.
- A self-recursive function (`f(x) = f(x) + 1`) throws `RangeError` after about 25 ms. `zeros(3000,3000)` takes about 40 ms, and `sum(map(range(1,1e6), f(x)=x^2))` about 160 ms, so a larger range can stall the thread: run programs under a time limit.
- `derivative('x^2*sin(x)', 'x')` works; there is no equation solver.
- **A worker thread's `resourceLimits` don't contain a large allocation.** `sum(range(1, 1e8))` in a worker with `maxOldGenerationSizeMb: 256` hits V8's fatal out-of-memory and aborts the whole Node process (Node 24). The runner therefore evaluates each program in its own `node -e` process with `--max-old-space-size`, which only takes itself down; spawning it and loading mathjs costs about 0.4 s.
- `math.Unit.isValuelessUnit(name)` tells a unit name (`m`, `km`, `N`, `g`, `T`) from a free one (`a`, `thrust`); a parsed program's `AssignmentNode`s and `FunctionAssignmentNode`s carry the assigned `name`.

One live call on `xiaomi/mimo-v2.6-flash` (gateway, DeepInfra) asked for a variant of the gold thrust Exercise with a program, a structured output of statement, solution, program and final answers by variable and unit. It answered in 15 s, 168 input and 172 output tokens, no reasoning, about $0.00005. The program ran, with the unit slip above.
