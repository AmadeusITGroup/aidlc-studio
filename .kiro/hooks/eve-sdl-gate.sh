#!/bin/sh
# eve-sdl-gate.sh — AI-DLC SDL hard gate (BLOCKING), run by the Kiro IDE
# PreToolUse hook (eve-sdl-gate.json) as:  sh .kiro/hooks/eve-sdl-gate.sh
#
# PreToolUse is the ONLY Kiro trigger whose exit 2 hard-blocks the tool call
# (its stderr is delivered to the AGENT), so this is where the SDL prerequisite
# is enforced. Runs in plain sh (no bun) so it still fires when bun itself is
# missing. Zero-cost pass (exit 0) when the prerequisites are satisfied.
#
# It blocks for ONE reason:
#   A) PREREQUISITE MISSING — bun and/or eve not installed / not on PATH. eve is
#      mandatory like bun (the git pre-commit SDL scan needs it). On WINDOWS,
#      git is ALSO mandatory: the SDL hooks and the git pre-commit hook are
#      POSIX-sh scripts, and on Windows the sh/bash that runs them ships with
#      Git for Windows. Prints the exact install steps as an AGENT DIRECTIVE.
#
# NOTE: SDL secret/vulnerability scanning itself runs at GIT PRE-COMMIT time
# (eve-sdl-precommit.sh), not here — this gate only guarantees the eve CLI is
# present so that scan can run. The old PostFileSave marker/re-scan path was
# removed together with the per-save scanner (eve-sdl-scan.sh).

# ---- Session sentinel (run-once short-circuit) -------------------------------
# The bun/eve/git prerequisite check only needs to run ONCE per session. The
# SessionStart eve-sdl-preflight verifies the prerequisites and writes this
# marker; while it is present the check already passed this session, so this gate
# returns immediately — a single near-free file test instead of re-running the
# probe on every tool call. When the marker is absent (prerequisites were missing
# at session start, or the preflight did not run) the gate does the real check
# below: it hard-blocks while anything is missing, and writes the marker itself
# once the prerequisites are satisfied so subsequent tool calls short-circuit too.
SENTINEL=".kiro/.sdl-prereqs-ok"
[ -f "$SENTINEL" ] && exit 0

# ---- OS detection ------------------------------------------------------------
# Windows via Git Bash/MSYS/Cygwin reports MINGW*/MSYS*/CYGWIN* from `uname -s`;
# native Windows sets the OS env var to "Windows_NT". Anything else (Darwin =
# macOS, Linux) is treated as POSIX where sh + git are already present.
is_win=""
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) is_win=1 ;;
  *) [ "${OS:-}" = "Windows_NT" ] && is_win=1 ;;
esac

# ---- (A) prerequisite tools --------------------------------------------------
m=""
command -v bun >/dev/null 2>&1 || m="$m bun"
command -v eve >/dev/null 2>&1 || m="$m eve"
# Windows-only: git provides the sh/bash runtime the .sh hooks + pre-commit need.
[ -n "$is_win" ] && { command -v git >/dev/null 2>&1 || m="$m git"; }
if [ -n "$m" ]; then
  rm -f "$SENTINEL" 2>/dev/null
  {
    echo "[AI-DLC SDL GATE] BLOCKED — required prerequisite tool(s) not installed / not on PATH:$m"
    echo ""
    echo "AGENT DIRECTIVE (act on this now): STOP the AI-DLC workflow. Do NOT retry this tool call and do NOT run any further tool calls or stages. In your very next reply to the user, present the installation steps below verbatim as a clear numbered checklist, tell the user the workflow is paused until the tool is installed, and wait for the user to confirm installation + reload the Kiro window before you continue. Do not summarize or collapse these steps."
    echo ""
    echo "INSTALL STEPS TO SHOW THE USER:"
    case "$m" in *eve*)
      echo "  eve (Amadeus EVE SDL CLI) — MANUAL install, behind Amadeus SSO. Requires an authenticated Amadeus network and Python >= 3.9.1. Run:"
      echo "      curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -" ;;
    esac
    case "$m" in *bun*)
      echo "  bun — run:"
      echo "      curl -fsSL https://bun.sh/install | bash" ;;
    esac
    case "$m" in *git*)
      echo "  git (Windows) — Git for Windows provides the sh/bash runtime the SDL .sh hooks and the pre-commit scan require, plus git itself. Install from:"
      echo "      https://git-scm.com/download/win     (or:  winget install --id Git.Git -e)"
      echo "      Then reopen the terminal / Kiro so git + sh are on PATH." ;;
    esac
    echo "  PATH: add the tool(s) to the NON-INTERACTIVE shell profile the harness spawns — ~/.zshenv (zsh) or ~/.bashrc (bash), NOT ~/.zshrc — then reload the Kiro window / restart the session and retry."
  } 1>&2
  exit 2
fi

# Prerequisites satisfied — record the session sentinel so the remaining tool
# calls in this session short-circuit at the top instead of re-probing.
: > "$SENTINEL" 2>/dev/null
exit 0
