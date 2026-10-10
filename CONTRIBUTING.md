# Contributing

## Setup

```bash
corepack enable
pnpm install
pnpm dev
```

## Workflow

1. Pick or open an issue. Use the templates — they keep acceptance criteria explicit.
2. Create a branch from `main`: `feat/12-user-profile`, `fix/34-login-redirect`, `chore/...`.
3. Make your change with tests. Run `pnpm check` before pushing.
4. Open a pull request and link the issue (`Closes #12`).
5. The PR title must follow [Conventional Commits](https://www.conventionalcommits.org) — PRs are squash-merged, so the title becomes the commit on `main` and feeds the changelog.

| Prefix      | Use for                             | Version bump |
| ----------- | ----------------------------------- | ------------ |
| `feat:`     | New user-facing functionality       | minor        |
| `fix:`      | Bug fixes                           | patch        |
| `perf:`     | Performance improvements            | patch        |
| `refactor:` | Code change without behavior change | —            |
| `test:`     | Tests only                          | —            |
| `docs:`     | Documentation only                  | —            |
| `ci:`       | CI/CD configuration                 | —            |
| `chore:`    | Tooling, dependencies, housekeeping | —            |

Add `!` (e.g. `feat!:`) for breaking changes.

## Required checks

`main` is protected. A PR can be merged only when these pass:

- Lint, typecheck & unit tests
- Build & E2E tests
- CodeQL
- Conventional Commits PR title

## Testing

- **Unit / component tests** live next to the code as `*.test.ts(x)` and run with Vitest.
- **End-to-end tests** live in `e2e/` and run with Playwright against the production build, with mock AI (`AI_PROVIDER=mock`) and local Supabase:
  ```bash
  pnpm exec playwright install chromium   # once
  pnpm db:start
  pnpm test:e2e   # rebuilds first when the code is newer than the last build
  ```
  For a signed-in test, import `test` and `expect` from `e2e/fixtures.ts` and use the `student` fixture: it creates a fresh Student through the local auth admin API and starts the test signed in. These tests skip when `PLAYWRIGHT_BASE_URL` points at a deployment.
