# Pull requests

Every change reaches `main` through a PR that the maintainer reviews and squash-merges. Agents push branches and open PRs; they never push to `main` or merge.

- **Branch:** `<type>/<issue>-<kebab-description>`, or `<type>/<kebab-description>` without an issue. The type is a Conventional Commits type: `feat`, `fix`, `refactor`, `test`, `chore` or `docs`.
- **Title:** Conventional Commits, in lower case after the type (`feat: parse materials into chunks`). It becomes the commit on `main`.
- **Body:** write it with the Write tool into your scratchpad and pass it with `--body-file`, also for `gh pr edit`. Multi-line `--body` strings break on shell quoting.
- **Draft:** a long run opens the PR as a draft after its first commit (`gh pr create --draft --base main`), pushes as it goes, and runs `gh pr ready` when done.

## Body

Start with one or two sentences on why the change exists, then use these headings, leaving out any that would be empty:

- `## What changes`: the behaviour and structure that changed, grouped by topic, not by file.
- `## Decisions`: choices the issue left open, and why each was made.
- `## Deploying needs`: migrations to apply to staging and production (list them with `git diff --name-only origin/main...HEAD -- supabase/migrations`), environment variables and provider settings. Write "Nothing beyond the code" if there are none.
- `## Try it`: the steps the maintainer takes in the running app before approving, each with what they should see. Start from the issue's `Try it` steps as they turned out, and add a step for whatever only the maintainer's eyes can judge.
- `## Checked`: what ran and passed, including live checks.
- `## Not verified`: what could not be checked, and why. Each line ends where it is picked up: a `Try it` step for the maintainer's eyes, or a `verify` issue ([issue-tracker.md](issue-tracker.md)) for what an agent can check with a live call or more time. A line worth neither says why.

End with `Closes #<n>` for every issue the PR resolves. Issues close when the PR merges, so leave them open.
