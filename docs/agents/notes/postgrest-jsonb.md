# jsonb filters with postgrest-js

Installed `@supabase/postgrest-js` 2.117.2 (`dist/index.mjs`, `contains`, line ~1734).

- **`contains` on a jsonb column takes JSON text.** An array value is sent as a Postgres array literal (`cs.{a,b}`), so objects become `{[object Object]}`. Pass `JSON.stringify(value)` instead; a string goes through as `cs.<text>`. Verified 2026-10-09 on the local stack: `.contains("parts", JSON.stringify([{ type: "data-material", data: { materialId } }]))` on `chat_messages.parts` finds the messages that attach a Material (`countChatsAttaching` in `src/features/courses/server/material-store.ts`).
- **The fake.** `fakeSupabase`'s `contains` takes the same JSON text and applies jsonb `@>` rules; it throws on a non-string.
