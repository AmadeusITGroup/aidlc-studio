#Requires -Version 5.1
<#
  eve-sdl-install-precommit.ps1 — WINDOWS-NATIVE fallback twin of
  eve-sdl-install-precommit.sh.

  OS-LEVEL DIVISION: the .sh script is the primary path (macOS/Linux, and Windows
  when Git-for-Windows `sh` is on PATH). THIS .ps1 runs only when the .sh path
  cannot — Windows with `sh` NOT on PATH — and is launched by the bun dispatcher
  eve-sdl-sh-fallback.ts at session start. It is behaviourally identical to the
  .sh twin: it auto-installs the AI-DLC SDL git pre-commit hook into THIS project
  so the user never has to copy or install it.

  Behaviour — SAFE BY DESIGN (identical to the .sh twin):
    * IDEMPOTENT: re-running is a no-op once our hook is in place.
    * NON-DESTRUCTIVE: never clobbers a pre-existing/foreign pre-commit hook — it
      prints how to chain ours instead.
    * NO GIT CONFIG CHANGES: it only READS core.hooksPath to honour a custom hooks
      dir. The installed hook is a thin `#!/bin/sh` wrapper that execs the shipped
      scanner (.kiro/hooks/eve-sdl-precommit.sh). Git runs pre-commit hooks with
      its OWN bundled sh even when `sh` is not on PATH, so the sh wrapper is the
      correct thing to write here too — the scan works on Windows regardless.
    * OPT-OUT: set AIDLC_SDL_NO_PRECOMMIT_INSTALL=1 to skip installation.

  Always exits 0 (SessionStart cannot block).
#>

$ErrorActionPreference = 'SilentlyContinue'

if ($env:AIDLC_SDL_NO_PRECOMMIT_INSTALL) { exit 0 }

# not a git repo -> nothing to wire
$root = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) { exit 0 }
$root = $root.Trim()

$scanner = Join-Path $root '.kiro/hooks/eve-sdl-precommit.sh'
if (-not (Test-Path -LiteralPath $scanner)) { exit 0 }  # scanner not shipped here

# Honour a custom hooks dir if the repo set one; else the standard .git/hooks.
$hp = (& git -C $root config --get core.hooksPath 2>$null)
if (-not [string]::IsNullOrWhiteSpace($hp)) {
  $hp = $hp.Trim()
  if ([System.IO.Path]::IsPathRooted($hp)) { $hooksdir = $hp } else { $hooksdir = Join-Path $root $hp }
} else {
  $hooksdir = Join-Path $root '.git/hooks'
}
New-Item -ItemType Directory -Force -Path $hooksdir | Out-Null
if (-not (Test-Path -LiteralPath $hooksdir)) { exit 0 }

$pc = Join-Path $hooksdir 'pre-commit'

if (Test-Path -LiteralPath $pc) {
  # Already ours? Idempotent no-op (quiet).
  if (Select-String -LiteralPath $pc -Pattern 'eve-sdl-precommit' -Quiet) { exit 0 }
  # A foreign pre-commit hook exists — DO NOT overwrite it.
  Write-Output "[SDL (ps1 fallback)] A pre-commit hook already exists at $pc and is not the AI-DLC SDL hook."
  Write-Output "[SDL (ps1 fallback)] To enable SDL scanning, add this line to it:"
  Write-Output '        sh "$(git rev-parse --show-toplevel)/.kiro/hooks/eve-sdl-precommit.sh" || exit 1'
  exit 0
}

# Install a thin `#!/bin/sh` wrapper that execs the shipped scanner. LF-only so
# git's bundled sh runs it cleanly on Windows.
$wrapper = @(
  '#!/bin/sh'
  '# eve-sdl-precommit (AI-DLC SDL) managed hook — auto-installed by'
  '# .kiro/hooks/eve-sdl-install-precommit.ps1 (SessionStart, Windows fallback).'
  '# Runs the Amadeus SDL secrets + opengrep scan over STAGED content and blocks'
  '# the commit on any finding. Delete this file to disable; it re-installs on'
  '# next session unless AIDLC_SDL_NO_PRECOMMIT_INSTALL=1.'
  'root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0'
  'exec sh "$root/.kiro/hooks/eve-sdl-precommit.sh" "$@"'
) -join "`n"
$wrapper += "`n"

# Write with no BOM and LF newlines (critical for a shell hook).
[System.IO.File]::WriteAllText($pc, $wrapper, (New-Object System.Text.UTF8Encoding($false)))

# chmod +x when a POSIX chmod is reachable (Git for Windows ships one); harmless
# no-op otherwise — Git for Windows runs hooks regardless of the executable bit.
& chmod +x $pc 2>$null | Out-Null

Write-Output "[SDL (ps1 fallback)] Installed the AI-DLC SDL git pre-commit hook at $pc"
Write-Output "[SDL (ps1 fallback)] It scans staged code at commit time and blocks on a secret or vulnerability. Bypass one commit with 'git commit --no-verify'."
exit 0
