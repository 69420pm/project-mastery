#!/usr/bin/env bash
# PreToolUse (Bash): block commands that destroy work or spend what parallel
# agents and the user share (exit 2 refuses the call and tells the model why).
# An agent may prefix the ALLOW_ variable named in a message only when the user
# or its prompt explicitly allowed that command, so every exception is visible
# in the transcript.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty')

# Where a command starts: the beginning of a line or after ; & | ( (but not
# a grep alternation's \|), then any VAR=value assignments. Text inside
# arguments, such as a grep pattern, does not match.
boundary='(^|[;&(]|(^|[^\\])\|)\s*'
runs() { grep -qE "$boundary(\S+=\S*\s+)*($1)" <<<"$cmd"; }
allowed() { grep -qE "$boundary(\S+=\S*\s+)*$1=1\s+(\S+=\S*\s+)*($2)" <<<"$cmd"; }
guard() {
  local var=$1 pattern=$2 message=$3
  if runs "$pattern" && ! allowed "$var" "$pattern"; then
    echo "$message Prefix $var=1 only if the user or your prompt allowed it." >&2
    exit 2
  fi
}

git='git(\s+-C\s+\S+)?\s+'
guard ALLOW_DISCARD \
  "$git(reset\s+(\S+\s+)*--hard|clean\s+(\S+\s+)*-[a-zA-Z]*f|checkout\s+(--\s+)?\.(\s|$)|restore\s+(-(-worktree|W)\s+)?\.(\s|$))" \
  "This git command discards uncommitted work. Commit first, or discard single files by name."

guard ALLOW_DB_RESET \
  'pnpm\s+(-s\s+)?(run\s+)?db:reset|(pnpm\s+exec\s+|npx\s+)?supabase\s+db\s+reset|pnpm\s+(-s\s+)?agent\s+reset' \
  "Parallel agents share the local Supabase database, so a reset wipes their data too. Apply new migrations with 'pnpm exec supabase migration up --local --include-all'."

guard ALLOW_LIVE_AI \
  'pnpm\s+(-s\s+)?(run\s+)?evals\b|(pnpm\s+exec\s+)?tsx\s+.*evals/run\.ts|curl\s+.*(generativelanguage\.googleapis\.com|ai-gateway\.vercel\.sh)' \
  "Evals and direct model calls spend the user's free-tier AI quota, which parallel agents share. Test with AI_PROVIDER=mock."

exit 0
