#!/bin/sh
# eve-sdl-credentials.sh — open an INTERACTIVE sign-in for AMAIISDOM so eve's
# opengrep scanner can authenticate.
#
# WHY THIS EXISTS: Kiro hooks run with NO TTY, so eve cannot prompt inside a hook
# (eve's PROMPT_ENABLED = stdout.isatty() AND stdin.isatty() is false there — it
# just prints "User prompt disabled"). This script is invoked by eve-sdl-scan.sh
# (on an opengrep auth failure) and by eve-sdl-preflight.sh (when the keychain has
# no AMAIISDOM credentials). It launches a SEPARATE, real interactive terminal
# where eve DOES prompt: username, then a HIDDEN password, with eve's built-in
# TWO retries, validated against AMAIISDOM (LDAP) and stored in the OS keychain.
# The credentials go straight into eve — never through this script, never through
# the agent/chat. If sign-in still fails after the retries, that same window
# prints detailed opengrep setup instructions.
#
# Debounced via a lock file so repeated saves don't stack up windows. Sessions
# with no interactive display (SSH / CI / headless) can't open a window, so they
# get the same instructions written to the SDL scan log instead. Never blocks;
# always exits 0.

vd=".kiro"
lock="$vd/.sdl-cred-prompt.lock"
log="$vd/sdl-scan.log"
DEBOUNCE=600
# Logging is OPT-IN (matches eve-sdl-scan.sh): silent unless AIDLC_SDL_DEBUG is
# set or .kiro/.sdl-debug exists. The user-facing action here is the interactive
# window that opens, not the log.
sdl_debug() { [ -n "${AIDLC_SDL_DEBUG:-}" ] || [ -f "$vd/.sdl-debug" ]; }
logw() { sdl_debug || return 0; mkdir -p "$vd" 2>/dev/null; printf '%s\n' "$*" >> "$log"; }

now=$(date +%s 2>/dev/null); case "$now" in ''|*[!0-9]*) now=0 ;; esac

# Debounce: skip if we already offered an interactive sign-in within DEBOUNCE seconds.
if [ -f "$lock" ] && [ "$now" -ne 0 ]; then
  prev=$(cat "$lock" 2>/dev/null); case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
  if [ $((now - prev)) -lt "$DEBOUNCE" ]; then
    logw "[SDL creds] interactive AMAIISDOM sign-in already offered in the last ${DEBOUNCE}s — not reopening."
    exit 0
  fi
fi

proj=$(pwd)

# Steps logged when no interactive window can be opened (headless/SSH/CI).
log_instructions() {
  logw "  1) Connect to the Amadeus network / VPN — AMAIISDOM is ldaps://ldap.iis.amadeus.net."
  logw "  2) Ensure eve is installed (Python >= 3.9.1):"
  logw "       curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -"
  logw "  3) Store credentials:  eve credentials amaiisdom <your-amadeus-username>"
  logw "  4) Verify:             eve scan opengrep <a-code-file>"
  logw "  5) More help: $proj/.kiro/knowledge/aidlc-devsecops-agent/aidlc-devsecops-references/security-scan-setup.md"
}

# Headless / remote / CI: no interactive window possible — log the steps and stop.
if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_TTY" ] || [ -n "$CI" ]; then
  logw "[SDL creds] headless/SSH/CI session — cannot open an interactive prompt. To enable opengrep:"
  log_instructions
  exit 0
fi

launched=0
os=$(uname 2>/dev/null)
case "$os" in
  Darwin)
    cf="${TMPDIR:-/tmp}/eve-sdl-amaiisdom-signin.command"
    # Header carries the project path + a PATH that finds eve in the spawned shell.
    printf '#!/bin/sh\nPROJ="%s"\nexport PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"\n' "$proj" > "$cf"
    # Literal body: eve does the prompting (hidden password + its own 2 retries).
    cat >> "$cf" <<'CMDEOF'
clear
printf '\n=========================================================\n'
printf '  opengrep / EVE SDL  -  AMAIISDOM sign-in\n'
printf '=========================================================\n\n'
printf 'The security scanner (opengrep) needs your Amadeus AMAIISDOM login.\n'
printf 'Enter your username, then your password (hidden). You get two retries.\n'
printf 'The password is stored in your login Keychain and is never seen by the AI agent.\n\n'
if ! command -v eve >/dev/null 2>&1; then
  printf 'ERROR: the "eve" CLI is not on PATH in this terminal.\n\n'
  printf '  1) Connect to the Amadeus network / VPN — AMAIISDOM is ldaps://ldap.iis.amadeus.net.\n'
  printf '  2) Install eve (Python >= 3.9.1):\n'
  printf '       curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -\n'
  printf '\nPress Return to close this window.\n'; read _; exit 0
fi
eve credentials amaiisdom
rc=$?
if [ "$rc" -ne 0 ]; then
  printf '\n--- Sign-in did not succeed after the retries. opengrep setup help ---\n'
  printf '  1) Connect to the Amadeus network / VPN — AMAIISDOM is ldaps://ldap.iis.amadeus.net.\n'
  printf '  2) Ensure eve is installed (Python >= 3.9.1):\n'
  printf '       curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -\n'
  printf '  3) Retry:  eve credentials amaiisdom <your-amadeus-username>\n'
  printf '  4) Verify: eve scan opengrep <a-code-file>\n'
  printf '  5) More help: %s/.kiro/knowledge/aidlc-devsecops-agent/aidlc-devsecops-references/security-scan-setup.md\n' "$PROJ"
  printf '              and .../aidlc-devsecops-references/support.md\n'
  printf '----------------------------------------------------------------------\n'
else
  printf '\nAMAIISDOM sign-in stored. Re-save your file (edit + save) to re-run opengrep.\n'
fi
printf '\nPress Return to close this window.\n'; read _
CMDEOF
    chmod +x "$cf"
    if command -v open >/dev/null 2>&1 && open -a Terminal "$cf" >/dev/null 2>&1; then launched=1; fi
    ;;
  Linux)
    ec="eve credentials amaiisdom; echo; echo 'If it failed: connect to the Amadeus VPN, verify eve is installed, and see $proj/.kiro/knowledge/aidlc-devsecops-agent/aidlc-devsecops-references/security-scan-setup.md'; echo; printf 'Press Return to close.\n'; read _"
    for term in x-terminal-emulator gnome-terminal konsole xfce4-terminal xterm; do
      if command -v "$term" >/dev/null 2>&1; then
        "$term" -e sh -c "$ec" >/dev/null 2>&1 && { launched=1; break; }
      fi
    done
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    # Git Bash / MSYS on Windows: open a new console window running eve.
    if command -v cmd >/dev/null 2>&1; then
      cmd //c start "" cmd //k "eve credentials amaiisdom" >/dev/null 2>&1 && launched=1
    fi
    ;;
esac

if [ "$launched" -eq 1 ]; then
  [ "$now" -ne 0 ] && printf '%s\n' "$now" > "$lock"
  logw "[SDL creds] opened an interactive AMAIISDOM sign-in window (eve prompts securely — hidden password, two retries; the agent never sees it)."
else
  logw "[SDL creds] could not open an interactive prompt on this system. To enable opengrep:"
  log_instructions
fi
exit 0
