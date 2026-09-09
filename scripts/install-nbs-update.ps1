param([string]$RevitYear = '2027', [switch]$ServerOnly, [switch]$PluginOnly)
$ErrorActionPreference = 'Stop'
if ($ServerOnly -and $PluginOnly) { throw 'Choose ServerOnly or PluginOnly, not both.' }
if ($RevitYear -ne '2027') { throw 'This update has only been built and checked for Revit 2027.' }
if (!$ServerOnly -and (Get-Process Revit -ErrorAction SilentlyContinue)) { throw 'Save and close Revit before installing.' }
$repoPath = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$installPath = Join-Path $env:APPDATA 'Autodesk/Revit/Addins/2027/revit_mcp_plugin'
if (!(Test-Path -LiteralPath (Join-Path $installPath 'RevitMCPPlugin.dll'))) { throw 'Existing plugin installation not found.' }
$backupPath = Join-Path $repoPath ('artifacts/install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$files = @(
    @{ Source = 'plugin/bin/Release/2027/RevitMCPPlugin.dll'; Target = 'RevitMCPPlugin.dll' },
    @{ Source = 'plugin/bin/Release/2027/RevitMCPPlugin.pdb'; Target = 'RevitMCPPlugin.pdb' },
    @{ Source = 'plugin/tool_schemas.json'; Target = 'tool_schemas.json' },
    @{ Source = 'server/build/index.js'; Target = 'Commands/RevitMCPCommandSet/server/build/index.js' },
    @{ Source = 'server/build/sql-wasm.wasm'; Target = 'Commands/RevitMCPCommandSet/server/build/sql-wasm.wasm' },
    @{ Source = 'server/build/cci-hierarchy.json'; Target = 'Commands/RevitMCPCommandSet/server/build/cci-hierarchy.json' }
)
if ($ServerOnly) {
    $files = @($files | Where-Object { $_.Source.StartsWith('server/') -or $_.Source -eq 'plugin/tool_schemas.json' })
}
if ($PluginOnly) {
    $files = @($files | Where-Object { $_.Source.StartsWith('plugin/bin/') })
}
$registryPath = Join-Path $installPath 'Commands/commandRegistry.json'
$registryHash = (Get-FileHash -LiteralPath $registryPath).Hash
# Validate all exact source and destination files before copying anything.
foreach ($file in $files) {
    foreach ($path in @((Join-Path $repoPath $file.Source), (Join-Path $installPath $file.Target))) {
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
    }
}
foreach ($file in $files) {
    $backupFile = Join-Path $backupPath $file.Target
    [void](New-Item -ItemType Directory -Path (Split-Path $backupFile -Parent) -Force)
    Copy-Item -LiteralPath (Join-Path $installPath $file.Target) -Destination $backupFile
}
try {
    foreach ($file in $files) {
        $sourceFile = Join-Path $repoPath $file.Source
        $targetFile = Join-Path $installPath $file.Target
        Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
        if ((Get-FileHash -LiteralPath $sourceFile).Hash -ne (Get-FileHash -LiteralPath $targetFile).Hash) {
            throw "Installed hash mismatch: $targetFile"
        }
        Write-Output "Verified: $($file.Target)"
    }
    if ((Get-FileHash -LiteralPath $registryPath).Hash -ne $registryHash) { throw 'Command registry changed during installation.' }
} catch {
    foreach ($file in $files) {
        Copy-Item -LiteralPath (Join-Path $backupPath $file.Target) -Destination (Join-Path $installPath $file.Target) -Force
    }
    throw
}
Write-Output "Backup: $backupPath"
Write-Output 'Installed successfully. Command registry preserved.'
if ($ServerOnly) { Write-Output 'Server-only update: no Revit DLL replaced. Restart MCP clients to load the new tools.' }
if ($PluginOnly) { Write-Output 'Plugin-only update: server, tool schemas, command registry and native NBS addin preserved.' }
