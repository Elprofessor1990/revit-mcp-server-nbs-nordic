# Helpers only: dot-sourcing this file never installs or configures anything.
$ErrorActionPreference = 'Stop'

function Build-LocalInstallation {
    param([string]$SourceRoot, [object[]]$Versions)
    foreach ($file in @('server/package-lock.json', 'plugin/RevitMCPPlugin.csproj', 'commandset/RevitMCPCommandSet.csproj')) {
        if (!(Test-Path -LiteralPath (Join-Path $SourceRoot $file) -PathType Leaf)) { throw "Not a complete source checkout: $file" }
    }
    if (!(Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'The matching .NET SDK must be installed on the build machine.' }
    Push-Location (Join-Path $SourceRoot 'server')
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & npm.cmd run build:local
        if ($LASTEXITCODE -ne 0) { throw 'Local server build failed.' }
    } finally { Pop-Location }
    foreach ($rv in $Versions) {
        $configuration = 'Release R' + ([string]$rv.Year).Substring(2)
        foreach ($project in @('plugin/RevitMCPPlugin.csproj', 'commandset/RevitMCPCommandSet.csproj')) {
            # Release packaging only; explicitly disable build-task live deployment.
            & dotnet build (Join-Path $SourceRoot $project) -c $configuration -p:SkipAddinCopy=true -p:PublishAddinFiles=false
            if ($LASTEXITCODE -ne 0) { throw "Build failed: $project ($configuration)" }
        }
    }
}

function Get-LocalInstallPlan {
    param([string]$SourceRoot, [ValidatePattern('^202[3-7]$')][string]$Year, [string]$AddinsDir)
    $destination = [IO.Path]::GetFullPath($AddinsDir).TrimEnd('\','/')
    $package = Join-Path $SourceRoot "plugin/bin/AddIn $Year Release R$($Year.Substring(2))"
    $plugin = Join-Path $package 'revit_mcp_plugin'
    foreach ($relative in @('RevitMCPPlugin.dll','RevitMCPSDK.dll','Newtonsoft.Json.dll',
        'Commands/commandRegistry.json',"Commands/RevitMCPCommandSet/$Year/RevitMCPCommandSet.dll",'Commands/RevitMCPCommandSet/command.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $plugin $relative) -PathType Leaf)) { throw "Incomplete local Revit $Year package: $relative" }
    }
    $pairs = @(@{ Source = (Join-Path $package 'mcp-servers-for-revit.addin'); Relative = 'mcp-servers-for-revit.addin' })
    # Only compiled artifacts, never packaged runtime state, arbitrary scripts or old server bundles.
    foreach ($file in Get-ChildItem -LiteralPath $plugin -File -Recurse) {
        $relative = $file.FullName.Substring($plugin.Length + 1)
        if ($relative -match '(^|[\\/])server[\\/]' -or $file.Extension -notin @('.dll','.pdb','.json')) { continue }
        if ($file.Extension -eq '.json' -and $relative -notmatch '\.(deps|runtimeconfig)\.json$|^Commands[\\/]commandRegistry\.json$|^Commands[\\/]RevitMCPCommandSet[\\/]command\.json$') { continue }
        if ($relative -eq 'tool_schemas.json') { continue }
        if ($relative -eq 'Commands\commandRegistry.json' -and (Test-Path -LiteralPath (Join-Path $destination "revit_mcp_plugin/$relative"))) { continue }
        $pairs += @{ Source = $file.FullName; Relative = "revit_mcp_plugin/$relative" }
    }
    $pairs += @{ Source = (Join-Path $SourceRoot 'plugin/tool_schemas.json'); Relative = 'revit_mcp_plugin/tool_schemas.json' }
    $serverRelative = 'revit_mcp_plugin/Commands/RevitMCPCommandSet/server'
    foreach ($name in @('index.js','sql-wasm.wasm','cci-hierarchy.json')) {
        $pairs += @{ Source = (Join-Path $SourceRoot "server/build/$name"); Relative = "$serverRelative/build/$name" }
    }
    $pairs += @{ Source = (Join-Path $SourceRoot 'server/package.json'); Relative = "$serverRelative/package.json" }
    foreach ($pair in $pairs) {
        if (!(Test-Path -LiteralPath $pair.Source -PathType Leaf)) { throw "Missing local artifact: $($pair.Source)" }
        $pair.Target = [IO.Path]::GetFullPath((Join-Path $destination $pair.Relative))
        if (!$pair.Target.StartsWith($destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe target path.' }
        # Refuse symlink/junction traversal when backing up or replacing artifacts.
        $parent = $pair.Target
        while ($parent) {
            if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse point in target: $parent" }
            $parent = Split-Path $parent -Parent
        }
    }
    [xml]$manifest = Get-Content -LiteralPath $pairs[0].Source -Raw
    if ($manifest.RevitAddIns.AddIn.Assembly -ne 'revit_mcp_plugin/RevitMCPPlugin.dll') { throw 'Unexpected local addin manifest assembly.' }
    [PSCustomObject]@{ Year = $Year; Files = $pairs; ServerPath = (Join-Path $destination "$serverRelative/build/index.js")
        BackupPath = (Join-Path $SourceRoot ('artifacts/installer-backup-' + $Year + '-' + [guid]::NewGuid().ToString('N'))) }
}

function Install-LocalPlan {
    param($Plan)
    if (Get-Process Revit -ErrorAction SilentlyContinue) { throw 'Revit is running; refusing to replace DLLs.' }
    $records = @()
    # Back up every existing target before the first replacement. No directory deletions.
    foreach ($file in $Plan.Files) {
        $backup = Join-Path $Plan.BackupPath $file.Relative
        $existed = Test-Path -LiteralPath $file.Target
        if ($existed) {
            [void](New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force)
            Copy-Item -LiteralPath $file.Target -Destination $backup
            if ((Get-FileHash -LiteralPath $file.Target).Hash -ne (Get-FileHash -LiteralPath $backup).Hash) { throw "Backup hash mismatch: $backup" }
        }
        $records += [PSCustomObject]@{ Target = $file.Target; Backup = $backup; Existed = $existed }
    }
    [void](New-Item -ItemType Directory -Path $Plan.BackupPath -Force)
    $records | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Plan.BackupPath 'manifest.json') -Encoding UTF8
    Write-Info "Recovery manifest: $($Plan.BackupPath)/manifest.json"
    $touched = @()
    try {
        foreach ($file in $Plan.Files) {
            [void](New-Item -ItemType Directory -Path (Split-Path $file.Target -Parent) -Force)
            $touched += $file.Target
            Copy-Item -LiteralPath $file.Source -Destination $file.Target -Force
            Unblock-File -LiteralPath $file.Target
            if ((Get-FileHash -LiteralPath $file.Source).Hash -ne (Get-FileHash -LiteralPath $file.Target).Hash) { throw "Installed hash mismatch: $($file.Target)" }
        }
    } catch {
        $failure = $_
        foreach ($record in $records | Where-Object { $_.Target -in $touched }) {
            if ($record.Existed) { Copy-Item -LiteralPath $record.Backup -Destination $record.Target -Force }
            elseif (Test-Path -LiteralPath $record.Target -PathType Leaf) { Remove-Item -LiteralPath $record.Target -Force }
        }
        throw $failure
    }
    Write-Ok "Revit $($Plan.Year) -- local artifacts hash-verified; existing registry and unrelated files preserved."
}

function Set-LocalClientConfig {
    param([string]$Path, [ValidateSet('json','toml')][string]$Format, [string]$NodePath, [string]$ServerPath)
    $exists = Test-Path -LiteralPath $Path
    $original = if ($exists) { [IO.File]::ReadAllText($Path) } else { '' }
    $entry = [PSCustomObject]@{ command = $NodePath; args = @($ServerPath) }
    if ($Format -eq 'json') {
        $config = if ($exists) { $original | ConvertFrom-Json -ErrorAction Stop } else { [PSCustomObject]@{} }
        if ($null -eq $config -or $config -isnot [PSCustomObject]) { throw 'Expected a JSON object; original preserved.' }
        if (!$config.PSObject.Properties['mcpServers']) { $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([PSCustomObject]@{}) }
        if ($config.mcpServers -isnot [PSCustomObject]) { throw 'mcpServers must be an object; original preserved.' }
        $previous = $config.mcpServers.PSObject.Properties['revit-mcp-nbs']
        if ($previous) {
            if (($previous.Value | ConvertTo-Json -Depth 100 -Compress) -eq ($entry | ConvertTo-Json -Compress)) { return }
            throw 'revit-mcp-nbs already has different settings; original preserved.'
        }
        $config.mcpServers | Add-Member -NotePropertyName 'revit-mcp-nbs' -NotePropertyValue $entry
        $updated = $config | ConvertTo-Json -Depth 100
    } else {
        # Append only. Never regex-rewrite a user's TOML tables or comments.
        $block = "[mcp_servers.revit-mcp-nbs]`ncommand = $($NodePath | ConvertTo-Json -Compress)`nargs = [$($ServerPath | ConvertTo-Json -Compress)]`n"
        if ($original.Replace("`r`n","`n").Contains($block)) { return }
        if ($original -match 'revit-mcp-nbs|(?m)^\s*["'']?mcp_servers["'']?\s*=|"""|''''''') {
            throw 'Ambiguous or existing MCP TOML configuration; original preserved. Use codex mcp add after review.'
        }
        $updated = $original + "`n" + $block
    }
    $parent = Split-Path $Path -Parent
    [void](New-Item -ItemType Directory -Path $parent -Force)
    $suffix = '.installer-' + [guid]::NewGuid().ToString('N')
    $temp = $Path + $suffix + '.tmp'
    try {
        [IO.File]::WriteAllText($temp, $updated, (New-Object Text.UTF8Encoding $false))
        if ($exists) {
            if ([IO.File]::ReadAllText($Path) -cne $original) { throw 'Config changed concurrently; refusing to overwrite.' }
            $backup = $Path + $suffix + '.bak'
            [IO.File]::Replace($temp, $Path, $backup)
            Write-Info "Config backup: $backup"
        } else { [IO.File]::Move($temp, $Path) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}
