#!/bin/sh
# eve-sdl-precommit.sh — AI-DLC SDL scan for a GIT PRE-COMMIT hook.
#
# Ships in .kiro/hooks/ and is wired into the project's git pre-commit hook by
# eve-sdl-install-precommit.sh (a SessionStart hook), so a user never has to
# copy or install anything by hand.
#
# It runs ONLY at `git commit` time, over the files that are actually STAGED,
# and scans the STAGED CONTENT (the exact blob being committed) — not the
# working-tree file — so a partially-staged file is checked correctly. (This
# replaces the old per-save/create scan, which added latency on every save.)
#
# It runs BOTH EVE scanners on each staged code file, but only the secrets
# scanner blocks:
#   * secrets  — HARD BLOCK. Offline, fast, reliable. A finding aborts the
#                commit. When the scanner is UNAVAILABLE (auth/network/timeout)
#                it downgrades to a warning so an offline machine can still
#                commit — unless SDL_PRECOMMIT_STRICT=1, which blocks then too.
#   * opengrep — ADVISORY ONLY. Needs AMAIISDOM auth + network. A finding is
#                reported as a WARNING but NEVER aborts the commit; an
#                unavailable/timed-out scan likewise only warns.
#                SDL_PRECOMMIT_STRICT does not make opengrep block.
#
# Usage:
#   eve-sdl-precommit.sh              scan staged files (the pre-commit path)
#   eve-sdl-precommit.sh --self-test  prove the scanners run/detect locally (no git needed)
#   eve-sdl-precommit.sh --verbose    scan staged files, printing each file + per-scanner result
#
# Env toggles:
#   SDL_PRECOMMIT_VERBOSE=1            per-file, per-scanner trace (same as --verbose).
#   SDL_PRECOMMIT_STRICT=1            block when the SECRETS scan is unavailable/timed out too (opengrep stays advisory).
#   SDL_PRECOMMIT_SKIP_IF_NO_EVE=1    skip the whole scan if eve is absent (default: block).
#   SDL_PRECOMMIT_OPENGREP_TIMEOUT=N  per-file opengrep wall-clock cap (default 60s).
#
# Bypass (defeats the control, use sparingly):  git commit --no-verify
#
# POSIX sh; no bun dependency.

VERBOSE="${SDL_PRECOMMIT_VERBOSE:-}"
MODE="scan"
case "${1:-}" in
  --self-test) MODE="self-test" ;;
  --verbose)   VERBOSE=1 ;;
  "" ) : ;;
  *) echo "usage: $0 [--self-test|--verbose]" 1>&2; exit 2 ;;
esac

vlog() { [ -n "$VERBOSE" ] || return 0; echo "$*" 1>&2; }

# ---- Content-based classification --------------------------------------------
# eve's exit code is a strong signal; output is also inspected so results are
# stable across eve versions/subcommands.
CLEAN_RE='no issue found|no issues found|no secrets found|no findings|0 findings|no results|nothing to scan|no problems found|no vulnerabilities found|no vulnerabilities'
ERROR_RE='amaiisdom (username|password)|user prompt disabled|unknown answer|authentication failed|authentication: *failure|unauthori[sz]ed|not authenticated|unable to connect|could not connect|connection refused|network (error|unreachable)|timed out|login failed'

classify() {  # $1=output $2=exit_code -> clean|finding|unavailable|inconclusive
  _o=$1; _c=$2
  [ -n "$(printf '%s' "$_o" | tr -d '[:space:]')" ] || { echo inconclusive; return; }
  printf '%s' "$_o" | grep -qiE "$CLEAN_RE" && { echo clean; return; }
  printf '%s' "$_o" | grep -qiE "$ERROR_RE" && { echo unavailable; return; }
  [ "$_c" -ne 0 ] && { echo finding; return; }
  printf '%s' "$_o" | grep -qiE 'secret|detected|finding|vulnerab' && { echo finding; return; }
  echo clean
}

# run_timed <secs> <cmd...> — hard wall-clock cap so an opengrep network stall
# can't hang the commit. Portable (macOS lacks GNU `timeout`). Prints output;
# returns the command's exit code, or 124 on timeout.
run_timed() {
  _secs=$1; shift
  _tf=$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/sdl_pc_$$_timed")
  "$@" >"$_tf" 2>&1 &
  _cp=$!; _n=0; _killed=0
  while kill -0 "$_cp" 2>/dev/null; do
    if [ "$_n" -ge "$_secs" ]; then
      kill -TERM "$_cp" 2>/dev/null; sleep 1; kill -KILL "$_cp" 2>/dev/null; _killed=1; break
    fi
    _n=$((_n + 1)); sleep 1
  done
  wait "$_cp" 2>/dev/null; _rc=$?
  [ "$_killed" -eq 1 ] && _rc=124
  cat "$_tf" 2>/dev/null; rm -f "$_tf" 2>/dev/null
  return $_rc
}

is_code() {  # $1 = path
  case "$1" in
    *.py|*.ts|*.tsx|*.js|*.jsx|*.java|*.go|*.rb|*.cs|*.kt|*.kts|*.scala|*.php|*.c|*.cc|*.cpp|*.h|*.hpp) return 0 ;;
    *) return 1 ;;
  esac
}

have_eve() { command -v eve >/dev/null 2>&1; }

og_timeout=${SDL_PRECOMMIT_OPENGREP_TIMEOUT:-60}

# ============================================================================
# SELF-TEST — prove locally that the scanners run and detect, without touching
# git or the working tree. Answers "are the security scanners actually firing?"
# ============================================================================
if [ "$MODE" = "self-test" ]; then
  echo "[SDL self-test] Verifying the EVE security scanners are reachable and detecting."
  if ! have_eve; then
    echo "  RESULT: 'eve' is NOT installed / not on PATH. In a real commit this BLOCKS (fail-closed)."
    echo "          Install eve, then re-run: .kiro/hooks/eve-sdl-precommit.sh --self-test"
    exit 1
  fi
  echo "  eve: $(command -v eve)"

  td=$(mktemp -d 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/sdl_selftest_$$"); mkdir -p "$td"
  trap 'rm -rf "$td" 2>/dev/null' EXIT INT TERM
  printf 'def add(a, b):\n    return a + b\n' > "$td/clean.py"
  printf 'API_KEY = "AKIAIOSFODNN7EXAMPLE"\n' > "$td/secret.py"

  rc_all=0

  # secrets — must be CLEAN on the clean fixture and a FINDING on the planted key.
  c_clean=$(classify "$(eve scan secrets run "$td/clean.py" --mode raw_file 2>&1)" $?)
  s_out=$(eve scan secrets run "$td/secret.py" --mode raw_file 2>&1); c_secret=$(classify "$s_out" $?)
  echo "  secrets scanner:"
  echo "    clean fixture  -> $c_clean  (expected: clean)"
  echo "    secret fixture -> $c_secret  (expected: finding)"
  if [ "$c_secret" = "finding" ] && [ "$c_clean" = "clean" ]; then
    echo "    => secrets scanner is LIVE and will BLOCK commits. OK"
  else
    echo "    => secrets scanner did NOT behave as expected. Check eve installation."
    rc_all=1
  fi

  # opengrep — report reachability/auth (a specific finding needs a real rule hit).
  o_out=$(run_timed "$og_timeout" eve scan opengrep "$td/secret.py"); o_rc=$?
  if [ "$o_rc" -eq 124 ]; then o_cls=unavailable; else o_cls=$(classify "$o_out" "$o_rc"); fi
  echo "  opengrep scanner:"
  echo "    status -> $o_cls"
  case "$o_cls" in
    clean|finding) echo "    => opengrep is REACHABLE; findings are reported as ADVISORY warnings (never block). OK" ;;
    unavailable)   echo "    => opengrep is UNAVAILABLE (auth/network). Sign in for advisory coverage:"
                   echo "         eve credentials amaiisdom <your-amadeus-username>"
                   echo "       (opengrep never blocks a commit; secrets is the blocking scanner.)" ;;
    *)             echo "    => opengrep result inconclusive; re-run after signing in." ;;
  esac

  echo "[SDL self-test] Done."
  exit $rc_all
fi

# ============================================================================
# SCAN — the pre-commit path: scan staged code files.
# ============================================================================
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "[SDL pre-commit] not a git repo — skipping." 1>&2; exit 0; }
cd "$root" || exit 0

if ! have_eve; then
  if [ -n "${SDL_PRECOMMIT_SKIP_IF_NO_EVE:-}" ]; then
    echo "[SDL pre-commit] 'eve' not on PATH — SKIPPING scan (SDL_PRECOMMIT_SKIP_IF_NO_EVE set)." 1>&2
    exit 0
  fi
  {
    echo "[SDL pre-commit] BLOCKED — the 'eve' SDL CLI is not installed / not on PATH,"
    echo "  so staged files cannot be scanned. Install eve, or bypass this ONE commit with:"
    echo "      SDL_PRECOMMIT_SKIP_IF_NO_EVE=1 git commit ...    (not recommended)"
  } 1>&2
  exit 1
fi

tmpd=$(mktemp -d 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/sdl_precommit_$$")
mkdir -p "$tmpd" 2>/dev/null
trap 'rm -rf "$tmpd" 2>/dev/null' EXIT INT TERM

strict="${SDL_PRECOMMIT_STRICT:-}"
findings=0
scanned=0
report=""

# Materialize a staged blob under tmpd, preserving the relative path. Echoes the
# temp path; non-zero if the blob can't be read (e.g. a staged deletion).
stage_blob() {  # $1 = repo-relative path
  _dst="$tmpd/blob/$1"
  mkdir -p "$(dirname "$_dst")" 2>/dev/null || return 1
  git show ":$1" > "$_dst" 2>/dev/null || return 1
  printf '%s' "$_dst"
}

# Iterate staged additions/copies/modifications. Newline-delimited: handles
# spaces in paths (IFS=newline); paths with embedded newlines are unsupported
# (pathological and rare).
OLDIFS=$IFS
IFS='
'
for f in $(git diff --cached --name-only --diff-filter=ACM 2>/dev/null); do
  is_code "$f" || { vlog "  skip (not code): $f"; continue; }
  dst=$(stage_blob "$f") || { vlog "  skip (no staged blob): $f"; continue; }
  scanned=$((scanned + 1))

  # --- secrets: HARD BLOCK ---------------------------------------------------
  s_out=$(eve scan secrets run "$dst" --mode raw_file 2>&1); s_rc=$?
  s_cls=$(classify "$s_out" "$s_rc")
  case "$s_cls" in
    finding)
      findings=$((findings + 1))
      report=$(printf '%s\n==== SECRET  %s ====\n%s\n' "$report" "$f" "$s_out")
      ;;
    unavailable)
      if [ -n "$strict" ]; then
        findings=$((findings + 1))
        report=$(printf '%s\n==== SECRET(unavailable, STRICT)  %s ====\n%s\n' "$report" "$f" "$s_out")
      else
        echo "[SDL pre-commit] WARNING: secrets scan could not complete for $f — not blocking on it." 1>&2
      fi
      ;;
  esac

  # --- opengrep: ADVISORY ONLY (warns, never blocks) -------------------------
  o_out=$(run_timed "$og_timeout" eve scan opengrep "$dst"); o_rc=$?
  if [ "$o_rc" -eq 124 ]; then o_cls=unavailable; o_out="$o_out
(opengrep timed out after ${og_timeout}s)"; else o_cls=$(classify "$o_out" "$o_rc"); fi
  # opengrep is advisory: a finding or an unavailable/timed-out scan only warns.
  # SDL_PRECOMMIT_STRICT does not apply to opengrep — secrets is the sole block.
  case "$o_cls" in
    finding)
      {
        echo "[SDL pre-commit] WARNING: opengrep finding in $f (advisory — NOT blocking). Review:"
        printf '%s\n' "$o_out"
      } 1>&2
      ;;
    unavailable)
      echo "[SDL pre-commit] WARNING: opengrep unavailable for $f (auth/network) — advisory, NOT blocking. Sign in with 'eve credentials amaiisdom <user>' for coverage." 1>&2
      ;;
  esac

  vlog "  scanned: $f  (secrets: $s_cls, opengrep: $o_cls)"
done
IFS=$OLDIFS

if [ "$findings" -gt 0 ]; then
  {
    echo ""
    echo "==================== AI-DLC SDL PRE-COMMIT: BLOCKED ===================="
    echo "Security finding(s) in staged content. Commit aborted."
    printf '%s\n' "$report"
    echo "Fix the issue(s) above and re-stage, then commit again."
    echo "Secrets false positive? Allowlist via the 'eve scan secrets allow ...' hint above."
    echo "======================================================================="
  } 1>&2
  exit 1
fi

echo "[SDL pre-commit] OK — scanned $scanned staged code file(s), no findings."
exit 0
