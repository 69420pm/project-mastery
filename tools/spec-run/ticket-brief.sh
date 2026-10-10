#!/usr/bin/env bash
# Prints the brief for one ticket of a spec run: the ticket with its comments,
# then only the spec sections its Context section names, then the headings of
# the rest of the spec:
#
#   tools/spec-run/ticket-brief.sh <ticket-number>
#
# Implementers get it from setup-worktree.sh; the orchestrator saves it for
# reviewers. A Context line names a section in bold, as in
# `- **Implementation Decisions › Overlaps and failures**: ...`; the part after
# the last › is the heading, or the start of it.
set -euo pipefail

ticket=${1:?usage: ticket-brief.sh <ticket-number>}
[[ "$ticket" =~ ^[0-9]+$ ]] || {
  echo "usage: ticket-brief.sh <ticket-number> (got '$ticket')" >&2
  exit 1
}

json=$(gh issue view "$ticket" --json number,title,body,comments,parent)
body=$(jq -r .body <<<"$json")

echo "# Ticket #$ticket: $(jq -r .title <<<"$json")"
echo
echo "$body"
jq -r '.comments[] | "\n## Comment by \(.author.login)\n\n\(.body)"' <<<"$json"

# The parent spec: the native sub-issue parent, else the "## Parent" section.
spec=$(jq -r '.parent.number // empty' <<<"$json")
if [[ -z "$spec" ]]; then
  spec=$(awk '/^## /{p = ($0 ~ /^## Parent/)} p' <<<"$body" | grep -oE '#[0-9]+' | head -n1 | tr -d '#') || true
fi
if [[ -z "$spec" ]]; then
  echo
  echo "(Ticket #$ticket names no parent spec.)"
  exit 0
fi
spec_body=$(gh issue view "$spec" --json body -q .body)

# Headings named in bold at the start of the Context section's list items.
mapfile -t sections < <(
  awk '/^## /{p = ($0 ~ /^## Context/); next} p' <<<"$body" |
    sed -nE 's/^[-*][[:space:]]+\*\*([^*]+)\*\*.*/\1/p' |
    sed -E 's/.*›[[:space:]]*//; s/[[:space:]]+$//'
)

echo
echo "---"
echo
echo "# Spec #$spec: the sections ticket #$ticket names"
for section in "${sections[@]}"; do
  text=$(awk -v name="$section" '
    match($0, /^#+ /) {
      level = RLENGTH - 1
      if (found && level <= found) exit
      heading = substr($0, RLENGTH + 1)
      # "Schema" also finds "Schema (one migration)".
      if (!found && (heading == name || index(heading, name " ") == 1)) found = level
    }
    found' <<<"$spec_body")
  echo
  if [[ -n "$text" ]]; then
    echo "$text"
  else
    echo "(No heading \"$section\" in spec #$spec.)"
  fi
done

echo
echo "# Other spec sections"
echo
echo "Read one by its heading only when the brief points to it, e.g.:"
echo "gh issue view $spec --json body -q .body | sed -n '/^### Overlaps and failures/,/^##/p'"
echo
grep -E '^#{2,3} ' <<<"$spec_body"
