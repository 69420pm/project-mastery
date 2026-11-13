#!/usr/bin/env bash
# Lists the PRs that wait for the maintainer and what stands in each one's way,
# for /sitting and /build:
#
#   tools/sitting/waiting.sh [pr ...]
#
# Without a number it goes through every open PR that is not a draft and that
# no bot opened. For each it prints the checks, whether the branch merges into
# main, the review, the Vercel preview, the migrations the PR adds, whether it
# is queued for the next shift (`ready-for-agent`) and its open comments.
#
# A comment is open when a person other than the PR's author wrote it after the
# author's last answer on the PR. A comment of the author that starts with
# "**Maintainer" holds the maintainer's words, taken down in /sitting: it counts
# as theirs, not as an answer.
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
if [[ $# -gt 0 ]]; then
  prs=("$@")
else
  mapfile -t prs < <(gh pr list --state open --limit 100 --json number,isDraft,author \
    --jq 'map(select((.isDraft | not) and (.author.is_bot | not))) | sort_by(.number)[].number')
fi
if [[ ${#prs[@]} -eq 0 ]]; then
  echo "No PR waits for review."
  exit 0
fi

for pr in "${prs[@]}"; do
  [[ "$pr" =~ ^[0-9]+$ ]] || {
    echo "usage: tools/sitting/waiting.sh [pr ...] (got '$pr')" >&2
    exit 1
  }
  json=$(gh pr view "$pr" --json number,title,url,author,headRefOid,mergeable,reviewDecision,labels,statusCheckRollup,files)
  author=$(jq -r .author.login <<<"$json")
  sha=$(jq -r .headRefOid <<<"$json")

  deployment=$(gh api "repos/$repo/deployments?sha=$sha&environment=Preview&per_page=1" --jq '.[0].id // empty')
  preview=""
  if [[ -n "$deployment" ]]; then
    preview=$(gh api "repos/$repo/deployments/$deployment/statuses?per_page=1" --jq '.[0].environment_url // empty')
  fi

  # Conversation comments, review bodies and inline review comments, in one
  # list of {who, type, at, where, body}.
  comments=$(
    {
      gh api --paginate "repos/$repo/issues/$pr/comments" \
        --jq '.[] | {who: .user.login, type: .user.type, at: .created_at, where: "", body}'
      gh api --paginate "repos/$repo/pulls/$pr/reviews" \
        --jq '.[] | select(.body != "") | {who: .user.login, type: .user.type, at: .submitted_at, where: "", body}'
      gh api --paginate "repos/$repo/pulls/$pr/comments" \
        --jq '.[] | {who: .user.login, type: .user.type, at: .created_at, where: "\(.path):\(.line // .original_line // "")", body}'
    } | jq -s --arg author "$author" '
      def relayed: .who == $author and (.body | startswith("**Maintainer"));
      ([.[] | select(.who == $author and (relayed | not)) | .at] | max // "") as $answered
      | [.[] | select(.type != "Bot" and (.who != $author or relayed) and .at > $answered)]
      | sort_by(.at)'
  )

  jq -r --arg preview "$preview" --argjson comments "$comments" '
    def failed: [.statusCheckRollup[]
      | select((.conclusion // .state) as $c
          | ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"] | index($c))
      | .name // .context];
    def running: [.statusCheckRollup[]
      | select((.status // "") as $s | (.state // "") as $c
          | ($s != "" and $s != "COMPLETED") or $c == "PENDING" or $c == "EXPECTED")];
    def migrations: [.files[].path | select(startswith("supabase/migrations/"))];
    "#\(.number) \(.title)",
    "  url         \(.url)",
    "  preview     \(if $preview == "" then "none yet" else $preview end)",
    "  checks      \(if (failed | length) > 0 then "failed: " + (failed | join(", "))
                     elif (running | length) > 0 then "running" else "pass" end)",
    "  main        \({MERGEABLE: "merges cleanly", CONFLICTING: "conflicts with main"}[.mergeable] // "not known yet, run again")",
    "  review      \({APPROVED: "approved", CHANGES_REQUESTED: "changes requested"}[.reviewDecision] // "waiting")",
    "  migrations  \(if (migrations | length) > 0 then migrations | join(", ") else "none" end)",
    "  queued      \(if [.labels[].name] | index("ready-for-agent") then "yes" else "no" end)",
    "  comments    \($comments | length) open",
    ($comments[]
      | "    \(.who), \(.at[0:16] | sub("T"; " "))\(if .where == "" then "" else ", " + .where end):",
        (.body | gsub("\r"; "") | split("\n") | map("      " + .) | join("\n"))),
    ""
  ' <<<"$json"
done
