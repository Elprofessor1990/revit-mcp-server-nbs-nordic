#Requires -Version 5.1
<#
.SYNOPSIS
    Install this checkout's local Revit + NBS Nordic build.
.DESCRIPTION
    STEP 1-4 retain the original prerequisite checks and Node.js LTS option.
    Uses the complete local Release build. -Build rebuilds from source first.
    The build machine needs npm and the matching .NET SDK; students do not.
    Installs hash-checked local artifacts with file backups and recovery manifest.
    Preserves existing commandRegistry.json, unrelated addins and user settings.
    Configures Claude Desktop, Claude Code and Codex independently/additively.
    Waits for a real read-only MCP -> Revit API response after opening Revit.
    See README.md, "Local NBS installer: writes and verification" for all paths.
.PARAMETER SourceRoot
    Source checkout; defaults to the parent of this scripts directory.
.PARAMETER Build
    Prepare local artifacts with npm ci/build:local and dotnet Release builds.
.PARAMETER RevitVersion
    Limit installation to one detected Revit version (2023-2027).
.PARAMETER SkipMcpConfig
    Skip all three client configurations.
.PARAMETER VerifyTimeoutSeconds
    Time to open Revit/project and verify the connection (default 180).
.PARAMETER Uninstall
    Original uninstall flow (deletes the plugin without backup; NOT reversible).
.PARAMETER Tag
    Legacy parameter. Release tags are rejected in this NBS edition.
.PARAMETER LocalZip
    Legacy parameter. Archives are rejected; use SourceRoot.
.EXAMPLE
    .\scripts\install.ps1 -RevitVersion 2027
#>
param(
    [ValidateSet('2023','2024','2025','2026','2027')]
    [string]$RevitVersion,
    [string]$Tag = 'latest',
    [switch]$Uninstall,
    [switch]$Force,
    [switch]$SkipNodeCheck,
    [switch]$SkipMcpConfig,
    [string]$LocalZip,
    [string]$SourceRoot = (Split-Path $PSScriptRoot -Parent),
    [switch]$Build,
    [ValidateRange(1,600)][int]$VerifyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# Release/archive installation is deliberately unavailable for the NBS edition.
if ($LocalZip -or $Tag -ne 'latest') { throw 'Use -SourceRoot with this local NBS checkout, not -LocalZip or -Tag.' }

# When run via `irm ... | iex` the script executes in the caller's scope and a
# pre-existing $Tag variable can override the param() default.  Guard against it.
if ([string]::IsNullOrWhiteSpace($Tag)) { $Tag = 'latest' }

# Force TLS 1.2  --  required for GitHub on older Windows 10 builds
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# -- Load shared module --------------------------------------------------------
# When run via `irm | iex`, $PSScriptRoot is empty and common.ps1 is unavailable.
# In that case, define constants and functions inline as a fallback.
$_commonPath = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'common.ps1' } else { $null }
if ($_commonPath -and (Test-Path $_commonPath)) {
    . $_commonPath
} else {
    # Inline fallback: constants
    $REPO          = 'LuDattilo/revit-mcp-server'
    $PLUGIN_NAME   = 'mcp-servers-for-revit'
    $PLUGIN_FOLDER = 'revit_mcp_plugin'
    $NPM_PACKAGE   = 'mcp-server-for-revit'
    $ADDIN_FILE    = "$PLUGIN_NAME.addin"
    $MIN_NODE      = 18
    $REVIT_YEARS   = 2023..2027

    # Inline fallback: shared functions
    function Get-RevitVersions {
        param([string[]]$Limit = @())
        $found = @()
        foreach ($year in $REVIT_YEARS) {
            if ($Limit.Count -gt 0 -and $year.ToString() -notin $Limit) { continue }
            $addinsDir = "$env:APPDATA\Autodesk\Revit\Addins\$year"
            $regPaths  = @(
                "HKLM:\SOFTWARE\Autodesk\Revit\Autodesk Revit $year",
                "HKLM:\SOFTWARE\WOW6432Node\Autodesk\Revit\Autodesk Revit $year"
            )
            $exePath = "C:\Program Files\Autodesk\Revit $year\Revit.exe"
            $inRegistry = ($regPaths | Where-Object { Test-Path $_ }).Count -gt 0
            $inAddins   = Test-Path $addinsDir
            $inExe      = Test-Path $exePath
            if ($inRegistry -or $inAddins -or $inExe) {
                $found += [PSCustomObject]@{ Year = $year; AddinsDir = $addinsDir }
            }
        }
        return $found
    }
    function Get-NodePath {
        $sysNode = Get-Command node -ErrorAction SilentlyContinue
        if ($sysNode) { return $sysNode.Source }
        foreach ($year in ($REVIT_YEARS | Sort-Object -Descending)) {
            $p = "$env:APPDATA\Autodesk\Revit\Addins\$year\$PLUGIN_FOLDER\Commands\RevitMCPCommandSet\server\runtime\node.exe"
            if (Test-Path $p) { return $p }
        }
        return $null
    }
    function Get-NodeStatus {
        $result = [PSCustomObject]@{
            Available = $false; Version = $null; Major = 0
            Path = $null; MeetsMinimum = $false; IsBundled = $false
        }
        $nodePath = Get-NodePath
        if ($nodePath) {
            $result.Available = $true
            $result.Path      = $nodePath
            $result.IsBundled = -not [bool](Get-Command node -ErrorAction SilentlyContinue)
            $result.Version   = (& "$nodePath" --version 2>$null).TrimStart('v')
            $result.Major     = [int](($result.Version -split '\.')[0])
            $result.MeetsMinimum = $result.Major -ge $MIN_NODE
        }
        return $result
    }
    function Get-McpServerPath {
        foreach ($year in ($REVIT_YEARS | Sort-Object -Descending)) {
            $serverJs = "$env:APPDATA\Autodesk\Revit\Addins\$year\$PLUGIN_FOLDER\Commands\RevitMCPCommandSet\server\build\index.js"
            if (Test-Path $serverJs) { return $serverJs }
        }
        return $null
    }
    function New-RevitMcpEntry {
        param([string]$ServerPath)
        $nodePath = Get-NodePath
        if ($nodePath) {
            return [PSCustomObject]@{ command = $nodePath; args = @($ServerPath) }
        }
        return [PSCustomObject]@{ command = 'cmd'; args = @('/c', 'node', $ServerPath) }
    }
    function Get-ClaudeDesktopDir {
        $candidates = @(
            "$env:APPDATA\Claude",
            (Get-ChildItem "$env:LOCALAPPDATA\Packages" -Filter "Claude_*" -ErrorAction SilentlyContinue |
                Select-Object -First 1 |
                ForEach-Object { "$($_.FullName)\LocalCache\Roaming\Claude" })
        )
        foreach ($c in $candidates) {
            if ($c -and (Test-Path $c)) { return $c }
        }
        return $null
    }
    function Get-ClaudeDesktopConfig {
        param([string]$ClaudeDir)
        $configPath = "$ClaudeDir\claude_desktop_config.json"
        $result = [PSCustomObject]@{
            Exists = $false; Path = $configPath; Config = $null
            HasRevitMcp = $false; RevitMcpEntry = $null
        }
        if (Test-Path $configPath) {
            $result.Exists = $true
            try {
                $result.Config = Get-Content $configPath -Raw | ConvertFrom-Json
                if ($result.Config.mcpServers -and $result.Config.mcpServers.'revit-mcp') {
                    $result.HasRevitMcp   = $true
                    $result.RevitMcpEntry = $result.Config.mcpServers.'revit-mcp'
                }
            } catch {}
        }
        return $result
    }
}

# -- Colour helpers ------------------------------------------------------------
function Write-Step { param([string]$m) Write-Host "  [*] $m" -ForegroundColor Cyan   }
function Write-Ok   { param([string]$m) Write-Host "  [+] $m" -ForegroundColor Green  }
function Write-Warn { param([string]$m) Write-Host "  [!] $m" -ForegroundColor Yellow }
function Write-Err  { param([string]$m) Write-Host "  [-] $m" -ForegroundColor Red    }
function Write-Info { param([string]$m) Write-Host "      $m" -ForegroundColor Gray   }

# -- Banner --------------------------------------------------------------------
Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host "      mcp-servers-for-revit   --   Installer"                           -ForegroundColor Cyan
Write-Host "      https://github.com/$REPO"                                     -ForegroundColor DarkCyan
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host ""

# =============================================================================
# STEP 1  --  SYSTEM CHECKS
# =============================================================================
Write-Host "  STEP 1  --  System checks" -ForegroundColor White

# PowerShell version
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Err "PowerShell 5.1 or later is required (found $($PSVersionTable.PSVersion))."
    Write-Info "Update: https://aka.ms/wmf5download"
    exit 1
}
Write-Ok "PowerShell $($PSVersionTable.PSVersion)"

# Windows 10+
$os = [System.Environment]::OSVersion.Version
if ($os.Major -lt 10) {
    Write-Err "Windows 10 or higher is required."
    exit 1
}
Write-Ok "Windows $($os.Major).$($os.Minor) build $($os.Build)"

# Internet connectivity
Write-Step "Testing internet connectivity..."
try {
    $null = Invoke-WebRequest -Uri 'https://api.github.com' -Method Head `
        -TimeoutSec 10 -Headers @{ 'User-Agent' = 'mcp-revit-installer' } -UseBasicParsing
    Write-Ok "Internet connection OK"
} catch {
    Write-Err "Cannot reach api.github.com  --  check your connection or proxy."
    exit 1
}
Write-Host ""

# =============================================================================
# STEP 2  --  DETECT REVIT INSTALLATIONS
# =============================================================================
Write-Host "  STEP 2  --  Detecting Revit installations" -ForegroundColor White

$limit = if ($RevitVersion) { @($RevitVersion) } else { @() }
$revitInstalls = Get-RevitVersions -Limit $limit

if ($revitInstalls.Count -eq 0) {
    if ($RevitVersion) {
        Write-Err "Revit $RevitVersion was not detected on this machine."
    } else {
        Write-Err "No Revit installation found (checked 2023-2027)."
    }
    Write-Info "Use -RevitVersion to override: .\install.ps1 -RevitVersion 2025"
    exit 1
}

foreach ($rv in $revitInstalls) {
    Write-Ok "Revit $($rv.Year)  ->  $($rv.AddinsDir)"
}
Write-Host ""

# =============================================================================
# STEP 3  --  UNINSTALL (if requested)
# =============================================================================
if ($Uninstall) {
    Write-Host "  STEP 3  --  Uninstall" -ForegroundColor White

    $toRemove = $revitInstalls | Where-Object {
        (Test-Path "$($_.AddinsDir)\$ADDIN_FILE") -or
        (Test-Path "$($_.AddinsDir)\$PLUGIN_FOLDER")
    }

    if ($toRemove.Count -eq 0) {
        Write-Warn "No installation found to remove."
        exit 0
    }

    Write-Warn "Will remove plugin from: $(($toRemove | ForEach-Object { $_.Year }) -join ', ')"
    $confirm = Read-Host "  Continue? [y/N]"
    if ($confirm -notmatch '^[yY]$') {
        Write-Warn "Uninstall cancelled."
        exit 0
    }

    foreach ($rv in $toRemove) {
        Write-Step "Removing Revit $($rv.Year)..."
        $revitRunning = Get-Process -Name "Revit" -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -match "Revit $($rv.Year)" -or $_.MainWindowTitle -match "$($rv.Year)" }
        if ($revitRunning) {
            Write-Warn "Revit $($rv.Year) appears to be running  --  close it first for a clean removal."
        }
        Remove-Item "$($rv.AddinsDir)\$ADDIN_FILE"         -Force -ErrorAction SilentlyContinue
        Remove-Item "$($rv.AddinsDir)\$PLUGIN_FOLDER"       -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item "$($rv.AddinsDir)\RevitMCPCommandSet"   -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "Revit $($rv.Year)  --  removed"
    }

    Write-Host ""
    Write-Ok "Uninstall complete. Restart Revit to apply changes."
    exit 0
}

# =============================================================================
# STEP 3  --  CHECK FOR EXISTING INSTALLATION
# =============================================================================
Write-Host "  STEP 3  --  Checking for existing installation" -ForegroundColor White

$alreadyInstalled = @($revitInstalls | Where-Object { Test-Path "$($_.AddinsDir)\$ADDIN_FILE" })

if ($alreadyInstalled.Count -gt 0) {
    foreach ($rv in $alreadyInstalled) {
        Write-Warn "Existing installation detected for Revit $($rv.Year)"
    }

    if ($Force) {
        Write-Step "-Force flag set  --  replacing existing installation."
    } else {
        Write-Host ""
        Write-Host "  An existing installation was detected." -ForegroundColor Yellow
        Write-Host "  [R] Replace   --  remove old version and install new  (default)" -ForegroundColor White
        Write-Host "  [S] Skip      --  keep existing, only install on new Revit versions" -ForegroundColor White
        Write-Host "  [A] Abort     --  cancel without any changes" -ForegroundColor White
        Write-Host ""

        do {
            $choice = (Read-Host "  Choose [R/s/a]").Trim().ToLower()
            if ($choice -eq '') { $choice = 'r' }
        } while ($choice -notin @('r','s','a'))

        switch ($choice) {
            'a' { Write-Warn "Installation aborted  --  no changes made."; exit 0 }
            's' {
                $skipYears = $alreadyInstalled | ForEach-Object { $_.Year }
                Write-Step "Skipping: $($skipYears -join ', ')"
                $revitInstalls = @($revitInstalls | Where-Object { $_.Year -notin $skipYears })
                if ($revitInstalls.Count -eq 0) {
                    Write-Warn "Nothing new to install."
                    exit 0
                }
            }
            'r' { Write-Step "Replacing existing installation." }
        }
    }
} else {
    Write-Ok "No existing installation found  --  fresh install"
}
Write-Host ""

# =============================================================================
# STEP 4  --  NODE.JS CHECK
# =============================================================================
if (-not $SkipNodeCheck) {
    Write-Host "  STEP 4  --  Node.js (required for MCP server)" -ForegroundColor White

    $nodeStatus = Get-NodeStatus
    $nodeOk     = $false

    if ($nodeStatus.Available) {
        if ($nodeStatus.MeetsMinimum) {
            if ($nodeStatus.IsBundled) {
                Write-Ok "Node.js $($nodeStatus.Version) (bundled portable runtime -- no system install needed)"
            } else {
                Write-Ok "Node.js $($nodeStatus.Version)"
            }
            $nodeOk = $true
        } else {
            Write-Warn "Node.js $($nodeStatus.Version) found but v$MIN_NODE+ is required"
        }
    } else {
        Write-Warn "Node.js not found (system or bundled)"
    }

    if (-not $nodeOk) {
        Write-Host ""
        Write-Host "  Node.js $MIN_NODE+ is needed to run the MCP server." -ForegroundColor Yellow
        Write-Host "  The Revit plugin will be installed regardless."       -ForegroundColor Yellow
        Write-Host "  Note: if you install from the official Release ZIP, Node.js is bundled automatically." -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  [1] Install Node.js LTS now (downloads installer)"  -ForegroundColor White
        Write-Host "  [2] Skip  --  I will install Node.js later"            -ForegroundColor White
        Write-Host "  [3] Skip  --  I only need the Revit plugin"            -ForegroundColor White
        Write-Host ""
        $nodeChoice = Read-Host "  Choose [1/2/3]"

        if ($nodeChoice -eq '1') {
            Write-Step "Fetching latest Node.js LTS version..."
            try {
                $nodeIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' `
                    -Headers @{ 'User-Agent' = 'mcp-revit-installer' }
                $lts     = $nodeIndex | Where-Object { $_.lts -ne $false } | Select-Object -First 1
                $arch    = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
                $msiUrl  = "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-$arch.msi"
                $msiPath = Join-Path $env:TEMP "node-lts-installer.msi"

                Write-Step "Downloading Node.js $($lts.version)..."
                Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath `
                    -Headers @{ 'User-Agent' = 'mcp-revit-installer' }
                Write-Ok "Downloaded"

                Write-Step "Launching installer (follow the wizard, then press Enter here)..."
                Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`"" -Wait

                $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                            [Environment]::GetEnvironmentVariable('Path','User')

                if (Get-Command node -ErrorAction SilentlyContinue) {
                    Write-Ok "Node.js $( (& node --version 2>$null) ) installed"
                    $nodeOk = $true
                } else {
                    Write-Warn "Node.js installed but not yet in PATH  --  restart PowerShell after this script"
                }
            } catch {
                Write-Err "Node.js install failed: $_"
                Write-Info "Install manually: https://nodejs.org"
            } finally {
                Remove-Item (Join-Path $env:TEMP "node-lts-installer.msi") -Force -ErrorAction SilentlyContinue
            }
        } elseif ($nodeChoice -eq '3') {
            $SkipMcpConfig = $true
        } else {
            Write-Warn "Skipping Node.js  --  install later from https://nodejs.org"
        }
    }

    # No npm package needed -- the local server installed with the plugin is used directly.
    Write-Host ""
}

# =============================================================================
# STEP 5 & 6  --  BUILD AND INSTALL THIS SOURCE CHECKOUT
# =============================================================================
. "$PSScriptRoot\install-local.ps1"
try {
    $sourcePath = [IO.Path]::GetFullPath($SourceRoot)
    Write-Host "  STEP 5  --  Local NBS build (no release download)" -ForegroundColor White
    if ($Build) { Build-LocalInstallation -SourceRoot $sourcePath -Versions $revitInstalls }
    else { Write-Step 'Using prepared local Release artifacts. No compiler needed on the student machine.' }
    # Preflight every target before modifying the first installation.
    $plans = @($revitInstalls | ForEach-Object {
        Get-LocalInstallPlan -SourceRoot $sourcePath -Year $_.Year -AddinsDir $_.AddinsDir
    })
    if (Get-Process Revit -ErrorAction SilentlyContinue) {
        throw 'Save and close Revit before installing. No Addins files have been changed.'
    }
    Write-Host "  STEP 6  --  Installing local build" -ForegroundColor White
    foreach ($plan in $plans) { Install-LocalPlan $plan }
} catch {
    Write-Err "Local installation failed: $_"
    exit 1
}

# =============================================================================
# STEP 7  --  INDEPENDENT, ADDITIVE CLIENT CONFIGURATION
# =============================================================================
$serverPath = $plans[-1].ServerPath
$nodePath = Get-NodePath
$configFailed = $false
if (-not $SkipMcpConfig) {
    Write-Host "  STEP 7  --  AI client configuration" -ForegroundColor White
    $desktopDir = Get-ClaudeDesktopDir
    if (-not $desktopDir) { $desktopDir = Join-Path $env:APPDATA 'Claude' }
    $claudeCodePath = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json' } else { Join-Path $env:USERPROFILE '.claude.json' }
    $codexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    foreach ($client in @(
        @{ Name = 'Claude Desktop'; Path = (Join-Path $desktopDir 'claude_desktop_config.json'); Format = 'json' },
        @{ Name = 'Claude Code'; Path = $claudeCodePath; Format = 'json' },
        @{ Name = 'Codex'; Path = (Join-Path $codexDir 'config.toml'); Format = 'toml' }
    )) {
        try {
            if (-not $nodePath) { throw 'Node.js unavailable; client configuration was not changed.' }
            Set-LocalClientConfig -Path $client.Path -Format $client.Format -NodePath $nodePath -ServerPath $serverPath
            Write-Ok "$($client.Name) -- configured: $($client.Path)"
        } catch {
            $configFailed = $true
            Write-Err "$($client.Name) -- $_"
        }
    }
}

# =============================================================================
# STEP 8  --  REAL MCP -> TCP -> REVIT READ-ONLY VERIFICATION
# =============================================================================
Write-Host "  STEP 8  --  Connection verification" -ForegroundColor White
Write-Step "Open Revit and your project now; then open your AI client. This window checks the connection automatically."
Write-Info "Waiting up to $VerifyTimeoutSeconds seconds. No model writes or NBS calls."
if (-not $nodePath) { Write-Err 'Cannot verify without Node.js.'; exit 1 }
& $nodePath "$PSScriptRoot\verify-install.mjs" $serverPath $VerifyTimeoutSeconds
if ($LASTEXITCODE -ne 0) {
    Write-Warn 'Files installed, but live connection NOT verified. See the diagnostic above; installation is not fully verified.'
    exit 1
}
if ($configFailed) { Write-Warn 'Connection verified, but one or more client configurations need attention.'; exit 1 }
Write-Ok 'Installation and live Revit connection verified. Open your AI client.'
