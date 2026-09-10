# Safe filesystem tests: unique directory under repo artifacts, never live Addins/configs.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/install-local.ps1"
function Write-Info { param($Message) }
function Write-Ok { param($Message) }
function Assert($Condition, $Message) { if (!$Condition) { throw $Message } }
function Expect-Rejection([scriptblock]$Action) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    Assert $rejected 'Expected safe rejection.'
}
$repo = Split-Path $PSScriptRoot -Parent
$testDir = Join-Path $repo ('artifacts/installer-test-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $testDir)
$original = (& git -C $repo show HEAD:scripts/install.ps1) -join "`n"
$current = (Get-Content "$PSScriptRoot/install.ps1") -join "`n"
$pattern = '(?s)# STEP 1  --  SYSTEM CHECKS.*?(?=# STEP 5)'
Assert ([regex]::Match($original,$pattern).Value -ceq [regex]::Match($current,$pattern).Value) 'STEP 1-4 changed.'
Write-Output 'PASS: STEP 1-4 identical to HEAD.'
foreach ($script in @('install.ps1','install-local.ps1','test-install-local.ps1')) {
    $tokens=$null; $errors=$null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $script),[ref]$tokens,[ref]$errors)
    Assert ($errors.Count -eq 0) "Parse failure: $script"
}
Write-Output 'PASS: PowerShell syntax.'
$json = Join-Path $testDir 'claude.json'
[IO.File]::WriteAllText($json, '{"theme":"dark","mcpServers":{"existing":{"command":"keep"}}}')
$before = [IO.File]::ReadAllText($json)
Set-LocalClientConfig $json json 'C:\Node path\node.exe' 'C:\Repo path\index.js'
$config = Get-Content $json -Raw | ConvertFrom-Json
Assert ($config.theme -eq 'dark' -and $config.mcpServers.existing.command -eq 'keep') 'Unrelated JSON changed.'
Assert ($config.mcpServers.'revit-mcp-nbs'.args[0] -eq 'C:\Repo path\index.js') 'Wrong server path.'
$backups = @(Get-ChildItem $testDir -Filter '*.bak')
Assert ($backups.Count -eq 1 -and [IO.File]::ReadAllText($backups[0].FullName) -ceq $before) 'Backup not byte-preserving.'
$hash = (Get-FileHash $json).Hash
Set-LocalClientConfig $json json 'C:\Node path\node.exe' 'C:\Repo path\index.js'
Assert ((Get-FileHash $json).Hash -eq $hash) 'JSON not idempotent.'
Expect-Rejection { Set-LocalClientConfig $json json 'different' 'different' }
Assert ((Get-FileHash $json).Hash -eq $hash) 'Conflict modified JSON.'
Write-Output 'PASS: additive JSON, backup, idempotency and conflict rejection.'
$invalid = Join-Path $testDir 'invalid.json'
[IO.File]::WriteAllText($invalid, '{broken')
Expect-Rejection { Set-LocalClientConfig $invalid json node server }
Assert ([IO.File]::ReadAllText($invalid) -ceq '{broken') 'Malformed JSON replaced.'
Write-Output 'PASS: malformed JSON preserved.'
$toml = Join-Path $testDir 'config.toml'
$prefix = "# retain comments`nmodel = 'test'`n[mcp_servers.existing]`ncommand = 'keep'`n"
[IO.File]::WriteAllText($toml, $prefix)
Set-LocalClientConfig $toml toml 'C:\Node path\node.exe' 'C:\Repo path\index.js'
Assert ([IO.File]::ReadAllText($toml).StartsWith($prefix)) 'Existing TOML changed.'
$hash = (Get-FileHash $toml).Hash
Set-LocalClientConfig $toml toml 'C:\Node path\node.exe' 'C:\Repo path\index.js'
Assert ((Get-FileHash $toml).Hash -eq $hash) 'TOML not idempotent.'
Expect-Rejection { Set-LocalClientConfig $toml toml different different }
Assert ((Get-FileHash $toml).Hash -eq $hash) 'TOML conflict changed original.'
Write-Output 'PASS: additive TOML, idempotency and conflict rejection.'
# A tiny compiled-artifact fixture tests deployment, not whether binaries load in Revit.
$fixture = Join-Path $testDir 'source'
$package = Join-Path $fixture 'plugin/bin/AddIn 2027 Release R27'
foreach ($relative in @('revit_mcp_plugin/RevitMCPPlugin.dll','revit_mcp_plugin/RevitMCPSDK.dll','revit_mcp_plugin/Newtonsoft.Json.dll',
    'revit_mcp_plugin/Commands/commandRegistry.json','revit_mcp_plugin/Commands/RevitMCPCommandSet/2027/RevitMCPCommandSet.dll',
    'revit_mcp_plugin/Commands/RevitMCPCommandSet/command.json')) {
    $file = Join-Path $package $relative
    [void](New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force)
    [IO.File]::WriteAllText($file, 'fixture')
}
Copy-Item "$repo/plugin/mcp-servers-for-revit.addin" $package
foreach ($relative in @('plugin/tool_schemas.json','server/package.json','server/build/index.js','server/build/sql-wasm.wasm','server/build/cci-hierarchy.json')) {
    $file = Join-Path $fixture $relative
    [void](New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force)
    [IO.File]::WriteAllText($file, 'fixture')
}
$target = Join-Path $testDir 'fake-addins'
$plan = Get-LocalInstallPlan $fixture 2027 $target
Install-LocalPlan $plan
Assert (Test-Path $plan.ServerPath) 'Server not installed.'
$registry = Join-Path $target 'revit_mcp_plugin/Commands/commandRegistry.json'
[IO.File]::WriteAllText($registry, 'custom registry')
$plan = Get-LocalInstallPlan $fixture 2027 $target
Install-LocalPlan $plan
Assert ([IO.File]::ReadAllText($registry) -ceq 'custom registry') 'Registry overwritten.'
Assert (Test-Path (Join-Path $plan.BackupPath 'manifest.json')) 'Recovery manifest missing.'
Write-Output 'PASS: local copy, hash verification, repeat install and registry preservation.'
$rollbackPlan = Get-LocalInstallPlan $fixture 2027 $target
$originalHash = (Get-FileHash $rollbackPlan.Files[0].Target).Hash
# Invalidate a source after preflight: first copy succeeds, second fails and rolls back.
$rollbackPlan.Files[1].Source = Join-Path $testDir 'missing-source'
Expect-Rejection { Install-LocalPlan $rollbackPlan }
Assert ((Get-FileHash $rollbackPlan.Files[0].Target).Hash -eq $originalHash) 'Rollback failed.'
Write-Output 'PASS: failure rollback.'
Write-Output "7 installer checks passed. Isolated artifacts retained: $testDir"
