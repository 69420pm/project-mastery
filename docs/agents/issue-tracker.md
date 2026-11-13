# Issue tracker

Specs and other issues live in GitHub Issues on `florianportscher/project-mastery`, created and read with `gh`, comments included.

- **Spec** (`/to-spec`): one issue of about one page, labelled with the `type:` that fits (a refactor or chore is `type: task`) and `ready-for-agent`. `/build <spec>` implements it in one PR, and takes the label off when it opens that PR, so the label lists what still waits for a build. A spec that an agent writes without the maintainer in the session, such as the result of a research build, gets `status: triage` in place of `ready-for-agent`: the maintainer approves its top half in `/sitting`.
- **Labels**: one `type:` label per issue, plus `area:` and `priority:` when they are clear. Available:
  - `type: feature`, `type: bug`, `type: task`, `type: docs`
  - `area: ui`, `area: api`, `area: infra`
  - `priority: high`, `priority: medium`, `priority: low`
  - `status: triage`, `status: blocked`, `ready-for-agent`, `verify`
- **Inbox**: a nit, bug or idea that can wait is an issue with a one-line title and `status: triage`, without a template or an investigation: `pnpm nit "<title>"` files one. The maintainer sorts the inbox in `/sitting`.
- **`verify`**: a check an agent can run that a build left open, in one line with the PR it comes from (see `Not verified` in [pull-requests.md](pull-requests.md)).
- **Waiting for the maintainer**: `status: blocked` plus a comment naming the decision or action needed. `gh issue list --label "status: blocked"` and `tools/sitting/waiting.sh` show everything that waits for them.
- **Change requests**: a comment of the maintainer on an open PR stays open until the PR's author answers on the PR. `/sitting` labels a PR with open comments, a failed check or a conflict `ready-for-agent`, and `/build` settles them on its branch ([pull-requests.md](pull-requests.md)).
- **Branches**: as in [pull-requests.md](pull-requests.md); `/build` names the branch after the spec.
- **Bodies**: follow the skill's template; the forms in `.github/ISSUE_TEMPLATE/` are for people using the web UI.
- **Closing**: issues close when the maintainer merges the PR that resolves them. Put `Closes #<n>` in the PR body for each issue it resolves, and leave issues open yourself.
