#!/bin/sh
# eve-sdl-install-precommit.sh — SessionStart: auto-install the AI-DLC SDL git
# pre-commit hook into THIS project, so a user never has to copy or install it.
#
# Invoked by the Kiro IDE SessionStart hook (eve-sdl-install-precommit.json) and
# the pre-1.0 promptSubmit twin (.kiro.hook) as:
#     sh .kiro/hooks/eve-sdl-install-precommit.sh
#
# Behaviour — SAFE BY DESIGN:
#   * IDEMPOTENT: re-running is a no-op once our hook is in place.
#   * NON-DESTRUCTIVE: never clobbers a pre-existing/foreign pre-commit hook — it
#     prints how to chain ours instead.
#   * NO GIT CONFIG CHANGES: it does NOT run `git config` (it only READS
#     core.hooksPath to honour a custom hooks dir), so a team's git setup is
#     untouched. The installed hook is a thin wrapper that execs the shipped
#     scanner (.kiro/hooks/eve-sdl-precommit.sh), so updates to the scanner take
#     effect with no reinstall.
#   * OPT-OUT: set AIDLC_SDL_NO_PRECOMMIT_INSTALL=1 to skip installation.
#
# Plain POSIX sh; no bun dependency. Always exits 0 (SessionStart cannot block).

[ -n "${AIDLC_SDL_NO_PRECOMMIT_INSTALL:-}" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0   # not a git repo — nothing to wire

scanner="$root/.kiro/hooks/eve-sdl-precommit.sh"
[ -f "$scanner" ] || exit 0                                    # scanner not shipped here — nothing to wire

# Honour a custom hooks dir if the repo set one; else the standard .git/hooks.
hp=$(git -C "$root" config --get core.hooksPath 2>/dev/null)
if [ -n "$hp" ]; then
  case "$hp" in /*) hooksdir="$hp" ;; *) hooksdir="$root/$hp" ;; esac
else
  hooksdir="$root/.git/hooks"
fi
mkdir -p "$hooksdir" 2>/dev/null || exit 0

pc="$hooksdir/pre-commit"

if [ -f "$pc" ]; then
  # Already ours? Idempotent no-op (quiet).
  grep -q "eve-sdl-precommit" "$pc" 2>/dev/null && exit 0
  # A foreign pre-commit hook exists — DO NOT overwrite it. Tell the user how to
  # chain our scan into their hook.
  echo "[SDL] A pre-commit hook already exists at $pc and is not the AI-DLC SDL hook."
  echo "[SDL] To enable SDL scanning, add this line to it:"
  echo "        sh \"\$(git rev-parse --show-toplevel)/.kiro/hooks/eve-sdl-precommit.sh\" || exit 1"
  exit 0
fi

# Install a thin wrapper that execs the shipped scanner.
{
  echo "#!/bin/sh"
  echo "# eve-sdl-precommit (AI-DLC SDL) managed hook — auto-installed by"
  echo "# .kiro/hooks/eve-sdl-install-precommit.sh (SessionStart). Runs the Amadeus"
  echo "# SDL secrets + opengrep scan over STAGED content and blocks the commit on"
  echo "# any finding. Delete this file to disable; it re-installs on next session"
  echo "# unless AIDLC_SDL_NO_PRECOMMIT_INSTALL=1."
  echo "root=\$(git rev-parse --show-toplevel 2>/dev/null) || exit 0"
  echo "exec sh \"\$root/.kiro/hooks/eve-sdl-precommit.sh\" \"\$@\""
} > "$pc" 2>/dev/null || exit 0
chmod +x "$pc" 2>/dev/null

echo "[SDL] Installed the AI-DLC SDL git pre-commit hook at $pc"
echo "[SDL] It scans staged code at commit time and blocks on a secret or vulnerability. Bypass one commit with 'git commit --no-verify'."
exit 0
