<#
.SYNOPSIS
    Fixes Example/test-groupstatus.ts so replying "!teststatus" to a video,
    sticker, or audio message actually posts THAT media as a group-status,
    instead of silently falling through to a plain text group-status.

    Root cause: the script only ever checked `quoted?.imageMessage`, so for
    any other quoted media type that variable was undefined, the "!quotedImage"
    guard on the text-status branch passed, and it posted text instead.

    Idempotent: safe to re-run.

.USAGE
    From the repo root (where src/ and Example/ live):
        .\apply-groupstatus-testfix.ps1

    Optional:
        .\apply-groupstatus-testfix.ps1 -RepoRoot "C:\path\to\wolfsocket"
        .\apply-groupstatus-testfix.ps1 -Force      # re-apply even if marker found
#>

param(
    [string]$RepoRoot = ".",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ExampleDir  = Join-Path $RepoRoot "Example"
$TargetFile  = Join-Path $ExampleDir "test-groupstatus.ts"
$SourceFile  = Join-Path $PSScriptRoot "test-groupstatus.ts"
$Marker      = "const quotedMedia = quotedImage || quotedVideo || quotedSticker || quotedAudio"

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

if (-not (Test-Path $ExampleDir)) {
    Write-Host "ERROR: $ExampleDir not found. Run this from your wolfsocket repo root, or pass -RepoRoot." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $SourceFile)) {
    Write-Host "ERROR: test-groupstatus.ts not found next to this script ($PSScriptRoot). Place it alongside apply-groupstatus-testfix.ps1." -ForegroundColor Red
    exit 1
}

Write-Step "Checking current state"

if (Test-Path $TargetFile) {
    $alreadyPatched = (Select-String -Path $TargetFile -Pattern ([regex]::Escape($Marker)) -Quiet)
    if ($alreadyPatched -and -not $Force) {
        Write-Ok "Example/test-groupstatus.ts already has the media-reply fix. Nothing to do."
        Write-Ok "(use -Force to overwrite anyway)"
        exit 0
    }

    $backupDir = Join-Path $RepoRoot "_wolf_backups"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $backupDir "test-groupstatus.ts.$stamp.bak"
    Copy-Item -Path $TargetFile -Destination $backupPath
    Write-Step "Backed up existing test-groupstatus.ts -> $backupPath"
} else {
    Write-Warn2 "No existing test-groupstatus.ts found -- creating fresh."
}

Write-Step "Writing fixed Example/test-groupstatus.ts"
Copy-Item -Path $SourceFile -Destination $TargetFile -Force
Write-Ok "test-groupstatus.ts updated"

Write-Step "Verifying with tsc --noEmit (non-blocking)"
Push-Location $RepoRoot
if (-not (Test-Path "node_modules\typescript")) {
    Write-Warn2 "typescript not installed yet -- skipping typecheck (run 'npm install' or 'yarn install' first)"
} else {
    try {
        npx --no-install tsc --noEmit
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "typecheck passed"
        } else {
            Write-Warn2 "typecheck reported issues -- review before committing"
        }
    } catch {
        Write-Warn2 "typecheck could not run -- review before committing"
    }
}
Pop-Location

Write-Step "Done. Run: npx tsx Example/test-groupstatus.ts"
Write-Step "Then in a group: reply '!teststatus' to a video, sticker, or audio message and check the group status tab."