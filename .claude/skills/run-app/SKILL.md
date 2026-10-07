---
name: run-app
description: Run, drive and verify Project Mastery in a real browser and database with `pnpm -s agent`. Starts the local stack, signs in as a test user, opens pages as text snapshots, clicks and types, reports compile, runtime and server errors, follows auth emails and runs SQL with Row Level Security. Use it after changing app code to confirm the change works at runtime, not only that it compiles. Also use it when asked to run, open, click through, screenshot or debug the app, or to check what a user sees.
---

# run-app

`pnpm -s agent <command>` (source in `tools/agent/`) is the only interface you need. It works only against the local stack, never against staging or production. Every command prints only what you need for the next step: a clean result is one line, and each error is printed in full once.

## Start

```bash
pnpm -s agent up       # idempotent: Supabase, test users, next dev in the background
pnpm -s agent status   # what is running, with URLs
```

If `up` reports "permission denied … docker.sock", this shell is not in the `docker` group yet. Tell the user to restart Claude Code from a new login shell; do not use sudo.

## The loop

1. `login [student|classmate]` when the page needs a signed-in user. This signs in through the real login form; the sign-in survives browser restarts.
2. `open <path>` prints the final URL (after redirects), an accessibility snapshot, and any new errors.
3. Act on refs (`@e9`) from the **latest** output; refs change when the page changes.
   - `act click @e9` runs one browser command, waits for the page to settle, then prints the page and new errors.
   - Fill several fields quietly with `browser fill @e10 "text"` (prints nothing on success), then finish with `act click @e14`.
4. After editing code, run `check`: compile issues across all routes, plus runtime and server errors. All clean prints three `ok` lines.

```
$ pnpm -s agent open /dashboard
http://localhost:3000/dashboard
- banner
  - link "Project Mastery" [ref=e3]
  - button "Account menu" [expanded=false, ref=e4]
- main
  - heading "Welcome" [level=1, ref=e5]
  - paragraph
    - StaticText "Signed in as student@example.com. Your courses will appear here."
```

Lines starting with `✗` are problems: `compile`, `runtime` and `console` errors (with `src/` frames), and `server` errors. "N runtime error(s) reported before are still present" means nothing new has appeared since the last report.

## Verify a change

Check all four before calling a change done:

| Question | How |
| --- | --- |
| Compiles? | `check` |
| Runs without errors? | the `✗` lines from `open`/`act`/`look`, then `check` |
| Does what was asked? | the snapshot shows the expected text and state; for data, `sql ... --as <user>` |
| React behaves? (when relevant) | `react tree`, `react inspect <id>`, `react renders start` … `react renders stop` |

## Auth, email and data

- Test users: `student` and `classmate` (emails `student@example.com` and `classmate@example.com`; `users` prints the password). Two users let you check that one user cannot see the other's data.
- New sign-ups: fill the "Create account" tab, then `mail <email>` prints the subject and links, and `open <link>` follows one.
- `sql "<query>"` runs as the superuser, which bypasses RLS. Use it only to set up or inspect data.
- `sql "<query>" --as student|classmate|anon|<email>` runs with that user's role and JWT claims, exactly like the app's requests. To verify a policy, expect `(0 rows)`, `UPDATE 0` or `permission denied`.
- `reset` rebuilds the database from migrations and recreates the test users. It wipes all local data, so ask first unless the user asked for a clean state. Then run `login` again.

## Seeing the page

- Prefer snapshots (a few hundred tokens) to screenshots (about 1.5k tokens or more).
- Use `shot` (or `shot --full`) only for layout and visual questions. It prints a PNG path; Read that file to look at it.
- `look` re-reads the current page without acting.
- Other browser commands go through `browser <command>`, for example: `type`, `press Enter`, `select @e4 "value"`, `check @e3`, `hover`, `scroll down 500`, `back`, `reload`, `get text @e5`, `wait --text "Saved"`, `find role button click --name "Save"`, `set viewport 390 844`. Run `browser --help` for the full list.

## Gotchas

- Never delete or move `.next` while the dev server runs. After changing `next.config.ts` or `.env.local`, run `down`, then `up`.
- When the browser and Next.js disagree, suspect the tooling first: `browser close`, then `open` again (the sign-in is kept).
- After the browser shows a server error page, every error check waits 5 seconds. The output then includes a note; `browser close` fixes it.
- `open /login` while signed in redirects to `/dashboard`. That is the app's behavior, not a bug.
- A deleted or reset user stays signed in until the session token expires (up to 1 hour), because the app verifies the token locally (`getClaims`). Run `login` again.
- A second checkout (a worktree) gets its own browser session and the next free port (3001 and up), but shares the local Supabase. Email links always point to port 3000.
- Logs: `.next/dev/logs/next-development.log`, and `node_modules/.cache/agent/next-dev.log` when `up` started the server.

`pnpm -s agent help` lists every command.
