# Issue tracker

Specs and other issues live in GitHub Issues on `69420pm/project-mastery`, created and read with `gh`, comments included.

- **Spec** (`/to-spec`): one issue of about one page, labelled with the `type:` that fits (a refactor or chore is `type: task`) and `ready-for-agent`. `/build <spec>` implements it in one PR.
- **Labels**: one `type:` label per issue, plus `area:` and `priority:` when they are clear. Available:
  - `type: feature`, `type: bug`, `type: task`, `type: docs`
  - `area: ui`, `area: api`, `area: infra`
  - `priority: high`, `priority: medium`, `priority: low`
  - `status: triage`, `status: blocked`, `ready-for-agent`
- **Branches**: as in [pull-requests.md](pull-requests.md); `/build` names the branch after the spec.
- **Bodies**: follow the skill's template; the forms in `.github/ISSUE_TEMPLATE/` are for people using the web UI.
- **Closing**: issues close when the maintainer merges the PR that resolves them. Put `Closes #<n>` in the PR body for each issue it resolves, and leave issues open yourself.
