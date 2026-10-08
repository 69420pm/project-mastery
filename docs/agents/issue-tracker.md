# Issue tracker

Specs and tickets live in GitHub Issues on `69420pm/project-mastery`, created with `gh`. When a skill says "publish to the issue tracker", create an issue; "fetch the ticket" means read the issue with its comments.

- **Spec** (`/to-spec`): one issue, labelled `type: feature` (`type: bug` for a bug).
- **Tickets** (`/to-tickets`): one issue each, labelled `type: feature` or `type: task`, created as sub-issues of the spec issue. Record blocking edges with GitHub's native "blocked by" relationship, not as text in the body.
- **Labels**: one `type:` label per issue, plus `area:` and `priority:` when they are clear. Available:
  - `type: feature`, `type: bug`, `type: task`, `type: docs`
  - `area: ui`, `area: api`, `area: infra`
  - `priority: high`, `priority: medium`, `priority: low`
  - `status: triage`, `status: blocked`, `ready-for-agent`
- **Branches**: the integration branch for a spec is `<type>/<spec-issue>-<kebab-description>` (`feat/42-exam-brief`) and gets one PR; ticket branches append the ticket number (`feat/42-exam-brief-43`) and merge into it locally.
- **Bodies**: follow the skill's template; the forms in `.github/ISSUE_TEMPLATE/` are for people using the web UI.
- **Closing**: issues close when the maintainer merges the PR that resolves them. Put `Closes #<n>` in the PR body for each issue it resolves, and leave issues open yourself.
