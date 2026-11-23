#Requires -Version 5.1
<#
  eve-sdl-preflight.ps1 — WINDOWS-NATIVE fallback twin of eve-sdl-preflight.sh.

  OS-LEVEL DIVISION: the .sh script is the primary path (macOS/Linux, and Windows
  when Git-for-Windows `sh` is on PATH). THIS .ps1 runs only when the .sh path
  cannot — Windows with `sh` NOT on PATH — launched by the bun dispatcher
  eve-sdl-sh-fallback.ts at session start. Behaviourally identical to the .sh twin.

  DETECT-AND-INSTRUCT (never blocks; SessionStart stdout is injected into the
  agent context). It checks:
    (A) PREREQUISITE TOOLS — bun (AI-DLC engine/hooks), eve (Amadeus SDL CLI), and
        on Windows git (supplies the sh/bash the .sh hooks + git pre-commit need).
        If missing, print an AGENT DIRECTIVE with the exact install steps; the
        PreToolUse eve-sdl-gate is what hard-blocks (when `sh` is present).
    (B) AMAIISDOM CREDENTIALS — eve's opengrep scanner authenticates to AMAIISDOM.
        A hook has no TTY, so eve cannot prompt here. When no credentials are
        stored we DIRECT the user to run `eve credentials amaiisdom <username>`
        themselves in a real terminal (eve prompts securely; the agent never sees
        the password) and open an interactive sign-in window via the .ps1
        credentials helper. NON-blocking: the local secrets scanner still enforces
        at commit time; only opengrep is skipped until credentials are set.

  Always exits 0.
#>

$ErrorActionPreference = 'SilentlyContinue'

# This .ps1 is the Windows fallback; on Windows git is a mandatory prerequisite
# (it supplies the sh the .sh hooks + git pre-commit hook run under).
$isWin = ($env:OS -eq 'Windows_NT') -or ($IsWindows -eq $true) -or ($null -eq $IsWindows)

$sentinel = '.kiro/.sdl-prereqs-ok'

function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# ---- (A) prerequisite tools --------------------------------------------------
$missing = @()
if (-not (Have 'bun')) { $missing += 'bun' }
if (-not (Have 'eve')) { $missing += 'eve' }
if ($isWin -and -not (Have 'git')) { $missing += 'git' }

if ($missing.Count -gt 0) {
  Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
  Write-Output ("[SDL preflight (ps1 fallback)] AI-DLC prerequisite tool(s) missing / not on PATH: " + ($missing -join ' '))
  Write-Output "AGENT DIRECTIVE: Before starting or continuing any AI-DLC stage, tell the user these tools are required and not yet installed, and present the install steps below as a numbered checklist. The PreToolUse eve-sdl-gate will hard-block every tool call until they are installed (when a POSIX sh is present), so do not attempt stage work until the user confirms installation and reloads the Kiro window."
  Write-Output "INSTALL STEPS TO SHOW THE USER:"
  if ($missing -contains 'eve') { Write-Output "  eve (Amadeus EVE SDL CLI) — MANUAL install, behind Amadeus SSO. Requires an authenticated Amadeus network and Python >= 3.9.1. Run: curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install | python3 -" }
  if ($missing -contains 'bun') { Write-Output "  bun — run (Windows PowerShell): powershell -c ""irm bun.sh/install.ps1 | iex""" }
  if ($missing -contains 'git') { Write-Output "  git (Windows) — Git for Windows provides the sh/bash runtime the SDL .sh hooks + pre-commit scan need, plus git itself. Install: https://git-scm.com/download/win  (or: winget install --id Git.Git -e), then reopen the terminal." }
  Write-Output "  PATH: add the tool(s) to PATH (a user or machine environment variable), then reload the Kiro window / restart the session."
  exit 0
}

# Prerequisites present — record the session sentinel.
New-Item -ItemType Directory -Force -Path '.kiro' | Out-Null
Set-Content -LiteralPath $sentinel -Value '' -NoNewline -ErrorAction SilentlyContinue

# ---- (B) AMAIISDOM credentials for opengrep ----------------------------------
# Best-effort: probe with any available Python + the `keyring` library eve uses
# (Windows Credential Manager backend). If no Python is reachable, stay silent —
# the git pre-commit scan (eve-sdl-precommit.sh) still detects an unavailable
# opengrep at commit time and only warns.
$cred = 'unknown'
$py = $null
foreach ($cand in @('py', 'python', 'python3')) {
  if (Have $cand) { $py = $cand; break }
}
if ($py) {
  $probe = @'
import keyring, getpass
h = "ldap.iis.amadeus.net"
u = keyring.get_password(h, h) or getpass.getuser()
print("present" if (u and keyring.get_password(h, u)) else "missing")
'@
  $out = (& $py -c $probe 2>$null)
  if ($LASTEXITCODE -eq 0 -and $out) { $cred = ($out | Select-Object -First 1).Trim() }
}

if ($cred -eq 'missing') {
  Write-Output "[SDL preflight (ps1 fallback)] AMAIISDOM credentials not found — the opengrep SDL scanner cannot authenticate."
  Write-Output "AGENT DIRECTIVE: opengrep (part of the Amadeus SDL scan) needs the user's AMAIISDOM credentials, which are NOT set. Ask the user to run the command below THEMSELVES in the Kiro integrated TERMINAL. Never run it for them, never ask them to paste a password into the chat, and never handle their password — eve prompts for it securely (input hidden) and stores it in the OS credential manager, so you (the agent) never see it."
  Write-Output "SHOW THE USER, VERBATIM:"
  Write-Output "    eve credentials amaiisdom <your-amadeus-username>"
  Write-Output "An interactive sign-in window is being opened so the user can enter it now. If no window appears, they run the command above in a terminal themselves. NON-blocking: the local secrets scanner still enforces; only opengrep is skipped until credentials are set."
  $creds = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'eve-sdl-credentials.ps1'
  if (Test-Path -LiteralPath $creds) {
    Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $creds) -WindowStyle Hidden -ErrorAction SilentlyContinue
  }
  exit 0
}

Write-Output "[SDL preflight (ps1 fallback)] OK: bun and eve are installed and on PATH; AMAIISDOM credentials $cred."
exit 0
