#!/bin/sh
# eve-sdl-preflight.sh — AI-DLC SDL session-start preflight (NON-blocking), run
# by the Kiro IDE preflight hooks:
#   v2  (eve-sdl-preflight.json, SessionStart):   sh .kiro/hooks/eve-sdl-preflight.sh
#   1.x (eve-sdl-preflight.kiro.hook, promptSubmit): sh .kiro/hooks/eve-sdl-preflight.sh
#
# SessionStart / promptSubmit CANNOT block, but their stdout is injected into the
# agent context, so this is a DETECT-AND-INSTRUCT surface: it never blocks, it
# just tells the agent what to surface to the user. The PreToolUse eve-sdl-gate
# is what hard-blocks on a missing prerequisite tool.
#
# Runs in plain POSIX sh (NO bun) so it still fires when bun itself is missing.
#
# It checks two things:
#   (A) PREREQUISITE TOOLS — bun (AI-DLC engine/hooks) and eve (Amadeus SDL CLI)
#       are installed and on PATH. If missing, print an AGENT DIRECTIVE with the
#       exact install steps (the gate hard-blocks until they are installed).
#   (B) AMAIISDOM CREDENTIALS — eve's opengrep scanner authenticates to AMAIISDOM
#       (LDAP host ldap.iis.amadeus.net). Credentials live in the OS keyring
#       (macOS Keychain / Windows Credential Manager / Linux Secret Service) via
#       the Python `keyring` library eve uses. A hook has NO TTY, so eve cannot
#       prompt here (it would hit "User prompt disabled"). If no credentials are
#       stored, we DIRECT THE USER to run `eve credentials amaiisdom <username>`
#       themselves in a real terminal, where eve prompts securely (password
#       concealed) and stores it — the agent never sees it. NON-blocking: the
#       local secrets scanner still enforces; only opengrep is skipped until the
#       credentials are set.

# ---- OS detection ------------------------------------------------------------
# On Windows the SDL hooks + git pre-commit hook are POSIX-sh scripts whose
# sh/bash runtime ships with Git for Windows, so git is a mandatory prerequisite
# there (like bun + eve). Detect Windows via uname (Git Bash/MSYS/Cygwin) or the
# OS env var; Darwin/Linux are POSIX where sh + git are already present.
is_win=""
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) is_win=1 ;;
  *) [ "${OS:-}" = "Windows_NT" ] && is_win=1 ;;
esac

# ---- Session sentinel --------------------------------------------------------
# The bun/eve/git prerequisite check only needs to run ONCE per session. This
# SessionStart preflight is that once-per-session surface, and it OWNS the marker
# the PreToolUse eve-sdl-gate reads: when the prerequisites are present it writes
# the marker (so the gate short-circuits to a near-free file test on every later
# tool call instead of re-probing), and when any are missing it removes the
# marker (so the gate re-checks and hard-blocks). A new session re-runs this
# preflight, so the marker never goes stale across sessions.
SENTINEL=".kiro/.sdl-prereqs-ok"

# ---- (A) prerequisite tools --------------------------------------------------
m=""
command -v bun >/dev/null 2>&1 || m="$m bun"
command -v eve >/dev/null 2>&1 || m="$m eve"
# Windows-only: git provides the sh/bash runtime the .sh hooks + pre-commit need.
[ -n "$is_win" ] && { command -v git >/dev/null 2>&1 || m="$m git"; }
if [ -n "$m" ]; then
  rm -f "$SENTINEL" 2>/dev/null
  echo "[SDL preflight] AI-DLC prerequisite tool(s) missing / not on PATH:$m"
  echo "AGENT DIRECTIVE: Before starting or continuing any AI-DLC stage, tell the user these tools are required and not yet installed, and present the install steps below as a numbered checklist. The PreToolUse eve-sdl-gate will hard-block every tool call until they are installed, so do not attempt stage work until the user confirms installation and reloads the Kiro window."
  echo "INSTALL STEPS TO SHOW THE USER:"
  case "$m" in *eve*) echo "  eve (Amadeus EVE SDL CLI) — MANUAL install, behind Amadeus SSO. Requires an authenticated Amadeus network and Python >= 3.9.1. Run: curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -" ;; esac
  case "$m" in *bun*) echo "  bun — run: curl -fsSL https://bun.sh/install | bash" ;; esac
  case "$m" in *git*) echo "  git (Windows) — Git for Windows provides the sh/bash runtime the SDL .sh hooks + pre-commit scan need, plus git itself. Install: https://git-scm.com/download/win  (or: winget install --id Git.Git -e), then reopen the terminal." ;; esac
  echo "  PATH: add the tool(s) to the NON-INTERACTIVE shell profile the harness spawns — ~/.zshenv (zsh) or ~/.bashrc (bash), NOT ~/.zshrc — then reload the Kiro window / restart the session."
  exit 0
fi

# Prerequisites present — record the session sentinel so the PreToolUse gate
# short-circuits (no per-tool-call re-check) for the rest of this session.
: > "$SENTINEL" 2>/dev/null

# ---- (B) AMAIISDOM credentials for opengrep ----------------------------------
# Probe with eve's OWN interpreter (the venv python from the launcher shebang):
# it is the same executable that stored the secret, so the OS keyring returns it
# without an access dialog and via the correct backend. If the interpreter can't
# be resolved (e.g. eve.exe on Windows has no readable shebang), stay silent —
# the runtime detection in eve-sdl-scan.sh still covers the missing-cred case
# cross-platform by parsing eve's own auth output.
evebin=$(command -v eve 2>/dev/null)
evepy=$(sed -n '1s/^#!//p' "$evebin" 2>/dev/null)
case "$evepy" in *[Pp]ython*) : ;; *) evepy="" ;; esac

cred="unknown"
if [ -n "$evepy" ] && [ -x "$evepy" ]; then
  cred=$("$evepy" -c 'import keyring, getpass
h = "ldap.iis.amadeus.net"
u = keyring.get_password(h, h) or getpass.getuser()
print("present" if (u and keyring.get_password(h, u)) else "missing")' 2>/dev/null) || cred="unknown"
fi

if [ "$cred" = "missing" ]; then
  echo "[SDL preflight] AMAIISDOM credentials not found — the opengrep SDL scanner cannot authenticate."
  echo "AGENT DIRECTIVE: opengrep (part of the Amadeus SDL scan) needs the user's AMAIISDOM credentials, which are NOT set. Ask the user to run the command below THEMSELVES in the Kiro integrated TERMINAL. Never run it for them, never ask them to paste a password into the chat, and never handle their password — eve prompts for it securely (input hidden) and stores it in the OS keychain/credential manager, so you (the agent) never see it."
  echo "SHOW THE USER, VERBATIM:"
  echo "    eve credentials amaiisdom <your-amadeus-username>"
  echo "An interactive sign-in window is being opened so the user can enter it now (eve prompts securely — hidden password, two retries; the agent never sees it). If no window appears, they run the command above in a terminal themselves. This is a NON-blocking notice: the local secrets scanner still runs and enforces; only opengrep is skipped until credentials are set."
  # Offer the interactive sign-in immediately (real TTY where eve CAN prompt).
  # Debounced; a no-op on headless/SSH/CI (logs setup steps instead).
  if [ -f ".kiro/hooks/eve-sdl-credentials.sh" ]; then
    sh .kiro/hooks/eve-sdl-credentials.sh >/dev/null 2>&1 &
  fi
  exit 0
fi

echo "[SDL preflight] OK: bun and eve are installed and on PATH; AMAIISDOM credentials $cred."
exit 0
