# AIDLC Studio — Setup Script
# This script configures a workspace for AI-DLC usage.
#
# Usage:
#   .\scripts\setup-aidlc.ps1 [-Source <path-or-url>] [-Force]
#
# Parameters:
#   -Source   Path to the amadeus-aidlc rules directory or git repo URL
#             Default: uses bundled rules from this extension
#   -Force    Overwrite existing configuration without prompting

param(
    [string]$Source = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# --- Configuration ---
$ProjectRoot = Get-Location
$KiroDir = Join-Path $ProjectRoot ".kiro"
$SteeringDir = Join-Path $KiroDir "steering"
$RuleDetailsDir = Join-Path $KiroDir "amadeus-aidlc-rule-details"
$AidlcWorkDir = Join-Path $ProjectRoot "aidlc"
$GitIgnorePath = Join-Path $ProjectRoot ".gitignore"

# --- Functions ---

function Write-Step {
    param([string]$Message)
    Write-Host "  [+] $Message" -ForegroundColor Green
}

function Write-Skip {
    param([string]$Message)
    Write-Host "  [~] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "  [!] $Message" -ForegroundColor Red
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
        Write-Step "Created: $Path"
    } else {
        Write-Skip "Exists: $Path"
    }
}

# --- Banner ---
Write-Host ""
Write-Host "  AIDLC Studio — Setup" -ForegroundColor Cyan
Write-Host "  =============================" -ForegroundColor Cyan
Write-Host ""

# --- Pre-flight checks ---
if ((Test-Path (Join-Path $SteeringDir "amadeus-aidlc-core.md")) -and (-not $Force)) {
    Write-Skip "AIDLC appears to be already configured in this workspace."
    Write-Host "  Use -Force to overwrite existing configuration." -ForegroundColor Gray
    Write-Host ""
    exit 0
}

# --- Step 1: Create directory structure ---
Write-Host "  Step 1: Directory Structure" -ForegroundColor White
Write-Host "  ----------------------------" -ForegroundColor Gray

Ensure-Directory $KiroDir
Ensure-Directory $SteeringDir
Ensure-Directory (Join-Path $KiroDir "hooks")
Ensure-Directory $RuleDetailsDir
Ensure-Directory $AidlcWorkDir
Ensure-Directory (Join-Path $AidlcWorkDir "spaces")
Ensure-Directory (Join-Path $AidlcWorkDir "spaces\default")
Ensure-Directory (Join-Path $AidlcWorkDir "spaces\default\intents")
Ensure-Directory (Join-Path $AidlcWorkDir "spaces\default\knowledge")

Write-Host ""

# --- Step 2: Copy/Download rule files ---
Write-Host "  Step 2: Rule Files" -ForegroundColor White
Write-Host "  -------------------" -ForegroundColor Gray

if ($Source -ne "") {
    if (Test-Path $Source) {
        # Local source path
        $RulesSource = Join-Path $Source "aws-aidlc-rules"
        $DetailsSource = Join-Path $Source "aws-aidlc-rule-details"

        if (Test-Path $RulesSource) {
            Copy-Item -Recurse -Force $RulesSource (Join-Path $SteeringDir "amadeus-aidlc-rules")
            Write-Step "Copied rules from: $RulesSource"
        } else {
            Write-Err "Rules not found at: $RulesSource"
            exit 1
        }

        if (Test-Path $DetailsSource) {
            Copy-Item -Recurse -Force $DetailsSource $RuleDetailsDir
            Write-Step "Copied rule details from: $DetailsSource"
        } else {
            Write-Err "Rule details not found at: $DetailsSource"
            exit 1
        }
    } elseif ($Source -match "^https?://") {
        # Git URL — clone to temp and copy
        $TempDir = Join-Path $env:TEMP "aidlc-setup-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Write-Step "Cloning from: $Source"
        git clone --depth 1 $Source $TempDir 2>$null

        if ($LASTEXITCODE -ne 0) {
            Write-Err "Failed to clone repository. Check URL and authentication."
            exit 1
        }

        $RulesSource = Join-Path $TempDir "aws-aidlc-rules"
        $DetailsSource = Join-Path $TempDir "aws-aidlc-rule-details"

        if (Test-Path $RulesSource) {
            Copy-Item -Recurse -Force $RulesSource (Join-Path $SteeringDir "amadeus-aidlc-rules")
            Write-Step "Copied rules from cloned repo"
        }

        if (Test-Path $DetailsSource) {
            Copy-Item -Recurse -Force $DetailsSource $RuleDetailsDir
            Write-Step "Copied rule details from cloned repo"
        }

        # Cleanup
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
        Write-Step "Cleaned up temp files"
    } else {
        Write-Err "Source must be a local path or https:// URL"
        exit 1
    }
} else {
    Write-Skip "No -Source specified. Steering files from this extension will be used directly."
    Write-Skip "To add the full Amadeus AIDLC rules, re-run with: -Source <path-to-rules>"
}

Write-Host ""

# --- Step 3: Update .gitignore ---
Write-Host "  Step 3: Git Configuration" -ForegroundColor White
Write-Host "  --------------------------" -ForegroundColor Gray

$GitIgnoreEntry = "`n# Amadeus AIDLC working directory`naidlc/`n"

if (Test-Path $GitIgnorePath) {
    $content = Get-Content $GitIgnorePath -Raw
    if ($content -notmatch "aidlc/") {
        Add-Content -Path $GitIgnorePath -Value $GitIgnoreEntry
        Write-Step "Added aidlc/ to .gitignore"
    } else {
        Write-Skip "aidlc/ already in .gitignore"
    }
} else {
    Set-Content -Path $GitIgnorePath -Value $GitIgnoreEntry
    Write-Step "Created .gitignore with aidlc/ entry"
}

Write-Host ""

# --- Step 4: Verify ---
Write-Host "  Step 4: Verification" -ForegroundColor White
Write-Host "  ---------------------" -ForegroundColor Gray

$checks = @(
    @{ Path = $SteeringDir; Name = ".kiro/steering/" },
    @{ Path = (Join-Path $KiroDir "hooks"); Name = ".kiro/hooks/" },
    @{ Path = $AidlcWorkDir; Name = "aidlc/" },
    @{ Path = (Join-Path $AidlcWorkDir "spaces\default\intents"); Name = "aidlc/spaces/default/intents/" },
    @{ Path = (Join-Path $AidlcWorkDir "spaces\default\knowledge"); Name = "aidlc/spaces/default/knowledge/" }
)

$allPassed = $true
foreach ($check in $checks) {
    if (Test-Path $check.Path) {
        Write-Step "$($check.Name)"
    } else {
        Write-Err "MISSING: $($check.Name)"
        $allPassed = $false
    }
}

Write-Host ""

# --- Summary ---
if ($allPassed) {
    Write-Host "  Setup Complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Directory structure:" -ForegroundColor Gray
    Write-Host "  .kiro/" -ForegroundColor White
    Write-Host "  ├── steering/" -ForegroundColor White
    Write-Host "  │   ├── amadeus-aidlc-core.md" -ForegroundColor White
    Write-Host "  │   ├── amadeus-aidlc-standards.md" -ForegroundColor White
    Write-Host "  │   ├── amadeus-aidlc-setup.md" -ForegroundColor White
    Write-Host "  │   └── amadeus-aidlc-reference.md" -ForegroundColor White
    Write-Host "  ├── hooks/" -ForegroundColor White
    Write-Host "  │   └── aidlc-session-init.json" -ForegroundColor White
    Write-Host "  └── amadeus-aidlc-rule-details/" -ForegroundColor White
    Write-Host "  aidlc/" -ForegroundColor White
    Write-Host "  └── spaces/default/{intents,knowledge}/" -ForegroundColor White
    Write-Host ""
    Write-Host "  Ready! Type 'Using AI-DLC, [your intent]' to start a workflow." -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Err "Setup completed with warnings. Check missing items above."
    exit 1
}
