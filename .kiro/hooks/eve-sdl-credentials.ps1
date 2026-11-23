#Requires -Version 5.1
<#
  eve-sdl-credentials.ps1 — WINDOWS-NATIVE fallback twin of eve-sdl-credentials.sh.

  OS-LEVEL DIVISION: the .sh script is the primary path (macOS/Linux, and Windows
  when Git-for-Windows `sh` is on PATH). THIS .ps1 runs only on the Windows-without-
  `sh` fallback path — it is invoked by eve-sdl-preflight.ps1 when the credential
  store has no AMAIISDOM credentials.

  WHY THIS EXISTS: Kiro hooks run with NO TTY, so eve cannot prompt inside a hook.
  This opens a SEPARATE, real interactive console window where eve DOES prompt:
  username, then a HIDDEN password, with eve's built-in TWO retries, validated
  against AMAIISDOM and stored in the OS credential manager. The credentials go
  straight into eve — never through this script, never through the agent/chat.

  Debounced via a lock file so repeated session starts don't stack up windows.
  Sessions with no interactive display (CI/remote) get the instructions logged
  instead. Never blocks; always exits 0.
#>

$ErrorActionPreference = 'SilentlyContinue'

$vd = '.kiro'
$lock = Join-Path $vd '.sdl-cred-prompt.lock'
$log = Join-Path $vd 'sdl-scan.log'
$DEBOUNCE = 600

# Logging is OPT-IN (matches the .sh twin): silent unless AIDLC_SDL_DEBUG is set
# or .kiro/.sdl-debug exists. The user-facing action is the window that opens.
function Sdl-Debug { return [bool]($env:AIDLC_SDL_DEBUG) -or (Test-Path -LiteralPath (Join-Path $vd '.sdl-debug')) }
function Log-W([string]$msg) {
  if (-not (Sdl-Debug)) { return }
  New-Item -ItemType Directory -Force -Path $vd | Out-Null
  Add-Content -LiteralPath $log -Value $msg
}

$now = [int][double]::Parse((Get-Date -UFormat %s))

# Debounce: skip if we already offered a sign-in within DEBOUNCE seconds.
if (Test-Path -LiteralPath $lock) {
  $prev = 0
  [int]::TryParse((Get-Content -LiteralPath $lock -Raw -ErrorAction SilentlyContinue), [ref]$prev) | Out-Null
  if (($now - $prev) -lt $DEBOUNCE) {
    Log-W "[SDL creds (ps1 fallback)] interactive AMAIISDOM sign-in already offered in the last ${DEBOUNCE}s — not reopening."
    exit 0
  }
}

$proj = (Get-Location).Path

function Log-Instructions {
  Log-W "  1) Connect to the Amadeus network / VPN — AMAIISDOM is ldaps://ldap.iis.amadeus.net."
  Log-W "  2) Ensure eve is installed (Python >= 3.9.1):"
  Log-W "       curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -"
  Log-W "  3) Store credentials:  eve credentials amaiisdom <your-amadeus-username>"
  Log-W "  4) Verify:             eve scan opengrep <a-code-file>"
  Log-W "  5) More help: $proj/.kiro/knowledge/aidlc-devsecops-agent/aidlc-devsecops-references/security-scan-setup.md"
}

# Headless / remote / CI: no interactive window possible — log the steps and stop.
if ($env:CI -or $env:SSH_CONNECTION -or $env:SSH_TTY) {
  Log-W "[SDL creds (ps1 fallback)] headless/CI session — cannot open an interactive prompt. To enable opengrep:"
  Log-Instructions
  exit 0
}

# Open a new console window running eve (a real TTY where eve prompts securely).
# The password goes straight into eve — never through this script or the agent.
$launched = $false
$eveMissingMsg = "ERROR: the 'eve' CLI is not on PATH in this window. Connect to the Amadeus network/VPN and install eve (Python >= 3.9.1): curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -"
$inner = "if (Get-Command eve -ErrorAction SilentlyContinue) { eve credentials amaiisdom } else { Write-Host '$eveMissingMsg' }; Write-Host ''; Read-Host 'Press Enter to close this window'"
try {
  Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', $inner) -ErrorAction Stop
  $launched = $true
} catch {
  $launched = $false
}

if ($launched) {
  Set-Content -LiteralPath $lock -Value "$now" -NoNewline -ErrorAction SilentlyContinue
  Log-W "[SDL creds (ps1 fallback)] opened an interactive AMAIISDOM sign-in window (eve prompts securely — hidden password, two retries; the agent never sees it)."
} else {
  Log-W "[SDL creds (ps1 fallback)] could not open an interactive prompt on this system. To enable opengrep:"
  Log-Instructions
}
exit 0
