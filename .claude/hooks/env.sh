# Sourced by the other hooks. Hooks run in a non-interactive shell, so a
# Node installed through fnm is not on PATH yet.
if ! command -v pnpm >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm:$PATH"
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)"
fi

# The checkout a path belongs to: the main checkout, or the agent worktree
# under .claude/worktrees/ that a subagent works in. Hooks run their tools
# there, because each checkout's ESLint and Prettier config ignores the
# worktrees nested inside it.
checkout_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null
}
