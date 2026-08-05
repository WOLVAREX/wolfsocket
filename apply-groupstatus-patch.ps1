<#
.SYNOPSIS
    Applies the "Group Status" (groupStatusMessageV2) feature to a WOLF TECH
    Baileys checkout, plus a small core fix so media (image/video/etc.)
    group-status posts get the correct 'mediatype' stanza attribute.
    Idempotent: safe to re-run, including after pulling upstream Baileys
    updates that overwrite messages-send.ts.

.USAGE
    From the repo root (where src/ lives):
        .\apply-groupstatus-patch.ps1

    Optional:
        .\apply-groupstatus-patch.ps1 -RepoRoot "C:\path\to\Baileys"
        .\apply-groupstatus-patch.ps1 -Force      # re-apply even if marker found
#>

param(
    [string]$RepoRoot = ".",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$SocketDir      = Join-Path $RepoRoot "src\Socket"
$TargetFile     = Join-Path $SocketDir "messages-send.ts"
$NewModuleFile  = Join-Path $SocketDir "groupStatus.ts"
$WiringMarker   = "sendGroupStatus: (jid: string, content: AnyMessageContent) =>"
$ImportLine     = "import { sendGroupStatus } from './groupStatus.js'"
$MediaTypeOld   = "const mediaType = getMediaType(message)"
$MediaTypeNew   = "const mediaType = getMediaType(normalizeMessageContent(message) || message)"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

if (-not (Test-Path $TargetFile)) {
    Write-Host "ERROR: $TargetFile not found. Run this from your Baileys repo root, or pass -RepoRoot." -ForegroundColor Red
    exit 1
}

Write-Step "Checking current state"

$wiringPatched   = (Select-String -Path $TargetFile -Pattern ([regex]::Escape($WiringMarker)) -Quiet)
$mediaTypePatched = (Select-String -Path $TargetFile -Pattern ([regex]::Escape($MediaTypeNew)) -Quiet)

if ($wiringPatched -and $mediaTypePatched -and -not $Force) {
    Write-Ok "messages-send.ts already fully patched. Nothing to do."
    Write-Ok "(use -Force to re-apply anyway)"
    exit 0
}

# --- 1. Drop in / refresh the groupStatus.ts module -------------------------
Write-Step "Writing src/Socket/groupStatus.ts"

$moduleSource = Join-Path $PSScriptRoot "groupStatus.ts"
if (-not (Test-Path $moduleSource)) {
    Write-Host "ERROR: groupStatus.ts not found next to this script ($PSScriptRoot). Place it alongside apply-groupstatus-patch.ps1." -ForegroundColor Red
    exit 1
}

Copy-Item -Path $moduleSource -Destination $NewModuleFile -Force
Write-Ok "groupStatus.ts written"

# --- 2. Backup messages-send.ts before touching it ---------------------------
$backupDir = Join-Path $RepoRoot "_wolf_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupDir "messages-send.ts.$stamp.bak"
Copy-Item -Path $TargetFile -Destination $backupPath
Write-Step "Backed up messages-send.ts -> $backupPath"

$content = Get-Content -Path $TargetFile -Raw

# --- 3. Patch the import ------------------------------------------------------
if ($content -notmatch ([regex]::Escape($ImportLine))) {
    Write-Step "Inserting import"
    $anchor = "import { getMessageReportingToken, shouldIncludeReportingToken } from '../Utils/reporting-utils'"
    if ($content -notmatch ([regex]::Escape($anchor))) {
        Write-Host "ERROR: expected anchor import not found. File structure may have changed upstream -- patch manually using messages-send.patch.md." -ForegroundColor Red
        exit 1
    }
    $content = $content -replace ([regex]::Escape($anchor)), "$anchor`n$ImportLine"
    Write-Ok "import inserted"
} else {
    Write-Ok "import already present"
}

# --- 4. Patch the returned socket object -------------------------------------
if ($content -notmatch ([regex]::Escape($WiringMarker))) {
    Write-Step "Wiring sendGroupStatus into the returned socket object"
    $returnAnchor = "assertSessions,`n`t`trelayMessage,"
    if ($content -notmatch ([regex]::Escape($returnAnchor))) {
        Write-Host "ERROR: expected 'relayMessage,' anchor not found in return block. Patch manually using messages-send.patch.md." -ForegroundColor Red
        exit 1
    }
    $injection = "assertSessions,`n`t`trelayMessage,`n`t`tsendGroupStatus: (jid: string, content: AnyMessageContent) =>`n`t`t`tsendGroupStatus(jid, content, {`n`t`t`t`trelayMessage,`n`t`t`t`twaUploadToServer,`n`t`t`t`tgenerateMessageId: () => generateMessageIDV2(sock.user?.id)`n`t`t`t}),"
    $content = $content -replace ([regex]::Escape($returnAnchor)), $injection
    Write-Ok "socket wiring inserted"
} else {
    Write-Ok "socket wiring already present"
}

# --- 5. Fix mediatype detection for wrapped message types --------------------
if ($content -notmatch ([regex]::Escape($MediaTypeNew))) {
    Write-Step "Fixing mediatype detection for wrapped message types (groupStatusMessageV2, etc.)"
    if ($content -notmatch ([regex]::Escape($MediaTypeOld))) {
        Write-Warn2 "expected mediaType line not found -- skipping this fix, apply manually via messages-send.patch.md if needed"
    } else {
        $content = $content -replace ([regex]::Escape($MediaTypeOld)), $MediaTypeNew
        Write-Ok "mediatype fix applied"
    }
} else {
    Write-Ok "mediatype fix already present"
}

Set-Content -Path $TargetFile -Value $content -NoNewline
Write-Ok "messages-send.ts updated"

# --- 6. Verify (TypeScript typecheck, non-fatal if it fails) -----------------
Write-Step "Verifying with tsc --noEmit (non-blocking)"
Push-Location $RepoRoot
if (-not (Test-Path "node_modules\typescript")) {
    Write-Warn2 "typescript not installed yet -- skipping typecheck (run 'npm install' first, then 'npx tsc --noEmit' to verify manually)"
} else {
    try {
        npx --no-install tsc --noEmit
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "typecheck passed"
        } else {
            Write-Warn2 "typecheck reported issues -- review before committing (backup is at $backupPath)"
        }
    } catch {
        Write-Warn2 "typecheck could not run -- review before committing (backup is at $backupPath)"
    }
}
Pop-Location

Write-Step "Done. sock.sendGroupStatus(jid, content) is now available."