# Workflow imports in jsdom tests

Importing `workflow/api` under Vitest's jsdom environment throws `Missing intrinsic getter: href` (from `@workflow/core`'s hardened serialization). `@/features/ingestion/server` loads it through `start-pairing.ts`, so a module that a feature's `index.ts` reaches (a client component's Server Action in `server/actions.ts`, say) must not import `ingestion/server`, or every component test importing that `index.ts` fails. Put such reads in a separate `server/` module that only `server.ts` exports.
