# Sourced by the other hooks. Hooks run in a non-interactive shell, so a
# Node installed through fnm is not on PATH yet.
if ! command -v pnpm >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm:$PATH"
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)"
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1
