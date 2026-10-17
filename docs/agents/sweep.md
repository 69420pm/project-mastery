# Sweep audits

Facts every `/sweep` agent shares. `/sweep` runs the agents; `/sweep-apply` builds what the user ticks.

## Inputs

- **Folder**: each sweep writes to `.sweep/<UTC date>/` (gitignored). Your prompt names it.
- **Checks** from `pnpm -s sweep`: `metrics.md` (lines of code, public exports and how many are used outside the unit, fan-in and fan-out, dependencies between units), `knip.txt` (unused files, exports and dependencies), `jscpd.txt` (duplicated code) and `coverage.md` (per unit and file).
- **Surviving mutants** from `pnpm -s sweep mutate`: `mutants/<unit>.md`, one per line. Only units with `domain/`, `server/`, `ai/`, `workflows/` or `lib/` code are mutated.
- **Units** and the paths each one holds are defined in `tools/sweep/units.ts`, with what every check leaves out (generated code, tests and test helpers).
- **Spec issues** of a unit: `git log --format=%s -- <paths>` lists squash-merged PRs as `(#<pr>)`, and `gh pr view <pr> --json closingIssuesReferences` names the issues each one closed.
- **Rejected** groups of earlier sweeps, with the user's reason, are in `docs/sweeps/<date>.md` (see [Record](#record)).

## Findings files

An auditor writes one file and changes nothing else; its reply is that file's path and nothing more.

| Agent            | File                |
| ---------------- | ------------------- |
| `module-auditor` | `modules/<unit>.md` |
| `test-auditor`   | `tests/<unit>.md`   |
| `architect`      | `architecture.md`   |
| `infra-auditor`  | `infra.md`          |

Each finding is a `###` heading naming the problem, then three lines:

- **Location**: `file:line`, one or more.
- **Evidence**: what the code, a check or a spec issue shows, quoted or cited.
- **Change**: the proposed change and what it gains.

A finding is a bug, a missing test on a critical path, or code that costs readers or maintainers: dead, duplicated, misplaced, misnamed against `GLOSSARY.md`, or contradicting a doc. Taste is not a finding. "No findings" is a complete file.

## Record

`/sweep-apply` adds `docs/sweeps/<sweep date>.md` in the stack's first PR, from the decision issue: the audited commit, the headline numbers, the issue link, and each group in a list as `applied` (ticked) or `rejected` (unticked), with the user's reason when the issue's comments give one. Parked groups are left out, so a later sweep can raise them again. The synthesizer skips a rejected group's findings until the code they name changes.
