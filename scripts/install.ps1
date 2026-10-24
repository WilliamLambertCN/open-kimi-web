$ErrorActionPreference = 'Stop'

function Get-OkwPlatform {
    $native = $env:PROCESSOR_ARCHITEW6432
    if (-not $native) { $native = $env:PROCESSOR_ARCHITECTURE }
    switch ($native.ToUpperInvariant()) {
        'AMD64' { return 'win-x64' }
        'ARM64' { return 'win-arm64' }
        default { throw 'Unsupported Windows architecture; x64 or arm64 is required.' }
    }
}

function Assert-OkwDirectory {
    param([string] $Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Installation directory must not contain links or non-directory ancestors.'
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if (-not $parent) { break }
        $current = $parent.FullName
    }
}

function Get-OkwNodeInfo {
    param([string] $Node, [string] $ExpectedVersion = '')
    if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { return $null }
    $probe = New-Object Diagnostics.Process
    $probe.StartInfo.FileName = $Node
    $probe.StartInfo.Arguments = '-p "JSON.stringify({version:process.version,path:process.execPath})"'
    $probe.StartInfo.UseShellExecute = $false
    $probe.StartInfo.CreateNoWindow = $true
    $probe.StartInfo.RedirectStandardOutput = $true
    $probe.StartInfo.RedirectStandardError = $true
    try {
        if (-not $probe.Start()) { return $null }
        if (-not $probe.WaitForExit(15000)) { $probe.Kill(); return $null }
        if ($probe.ExitCode -ne 0) { return $null }
        $info = $probe.StandardOutput.ReadToEnd() | ConvertFrom-Json
        if ($info.version -notmatch '^v(\d+\.\d+\.\d+)$') { return $null }
        if ([Version] $Matches[1] -lt [Version] '22.19.0') { return $null }
        if ($ExpectedVersion -and $info.version -ne $ExpectedVersion) { return $null }
        $npm = Join-Path (Split-Path -Parent $info.path) 'node_modules/npm/bin/npm-cli.js'
        if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { return $null }
        $probe.StartInfo.FileName = $info.path
        $probe.StartInfo.Arguments = '"' + $npm + '" --version'
        if (-not $probe.Start()) { return $null }
        if (-not $probe.WaitForExit(15000)) { $probe.Kill(); return $null }
        if ($probe.ExitCode -ne 0 -or $probe.StandardOutput.ReadToEnd().Trim() -notmatch '^\d+\.\d+\.\d+$') {
            return $null
        }
        return [pscustomobject] @{ Node = $info.path; Npm = $npm; Version = $info.version }
    } catch { return $null } finally { $probe.Dispose() }
}

function Invoke-OkwDownload {
    param([string] $Url, [string] $Destination)
    $uri = [Uri] $Url
    $hosts = @('nodejs.org', 'api.github.com', 'codeload.github.com')
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin $hosts -or $uri.UserInfo -or $uri.Port -ne 443) {
        throw 'Download URL is not an approved HTTPS origin.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor
        [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 180 -MaximumRedirection 0 `
            -Headers @{ 'User-Agent' = 'open-kimi-web-installer'; 'Accept' = 'application/vnd.github+json' }
    } catch { throw 'Download failed; check HTTPS connectivity and retry. No installation was replaced.' }
}

function Get-OkwPrivateNode {
    param([string] $InstallHome, [string] $Platform)
    $version = 'v22.23.3'
    $hashes = @{
        'win-x64' = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
        'win-arm64' = '33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535'
    }
    if (-not $hashes.ContainsKey($Platform)) { throw 'Unsupported Node platform.' }
    $runtime = Join-Path $InstallHome 'runtime'
    Assert-OkwDirectory $runtime
    [IO.Directory]::CreateDirectory($runtime) | Out-Null
    $name = "node-$version-$Platform"
    $destination = Join-Path $runtime $name
    $lockPath = Join-Path $runtime "$name.lock"
    $lock = $null
    $stage = $null
    try {
        try { $lock = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None') }
        catch { throw 'Private Node runtime is locked; retry after the other installer finishes.' }
        Assert-OkwDirectory $destination
        if (Test-Path -LiteralPath $destination) {
            $existing = Get-OkwNodeInfo (Join-Path $destination 'node.exe') $version
            if (-not $existing) { throw 'Existing private Node directory is unrecognized; it was not overwritten.' }
            return $existing
        }
        $stage = Join-Path $runtime ('.stage-' + [Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        $archive = Join-Path $stage 'node.zip'
        Invoke-OkwDownload "https://nodejs.org/dist/$version/$name.zip" $archive
        $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($digest -ne $hashes[$Platform]) { throw 'Node archive SHA256 mismatch; nothing was extracted.' }
        $unpacked = Join-Path $stage 'unpacked'
        Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
        $entries = @(Get-ChildItem -LiteralPath $unpacked -Force)
        if ($entries.Count -ne 1 -or $entries[0].Name -ne $name -or -not $entries[0].PSIsContainer) {
            throw 'Node archive has an unexpected top-level layout.'
        }
        Assert-OkwDirectory $entries[0].FullName
        $verified = Get-OkwNodeInfo (Join-Path $entries[0].FullName 'node.exe') $version
        if (-not $verified) { throw 'Extracted Node version or adjacent npm CLI is invalid.' }
        [IO.Directory]::Move($entries[0].FullName, $destination)
        return Get-OkwNodeInfo (Join-Path $destination 'node.exe') $version
    } finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
        if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath -Force }
    }
}

function Get-OkwCoordinator {
    param([string] $ScriptDirectory, [string] $Revision, [string] $Temporary)
    if ($Revision -and $Revision -notmatch '^[0-9a-fA-F]{40}$') { throw 'Revision must be a full 40-digit commit SHA.' }
    $local = if ($ScriptDirectory) { Join-Path $ScriptDirectory 'install.mjs' } else { '' }
    if (-not $Revision -and $local -and (Test-Path -LiteralPath $local -PathType Leaf)) { return $local }
    if (-not $Revision) {
        $metadata = Join-Path $Temporary 'commit.json'
        Invoke-OkwDownload 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/main' $metadata
        $Revision = (Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json).sha
        if ($Revision -notmatch '^[0-9a-fA-F]{40}$') { throw 'GitHub returned an invalid commit SHA.' }
    }
    $Revision = $Revision.ToLowerInvariant()
    $archive = Join-Path $Temporary 'source.zip'
    $url = "https://codeload.github.com/WilliamLambertCN/open-kimi-web/zip/$Revision"
    Invoke-OkwDownload $url $archive
    $unpacked = Join-Path $Temporary 'source'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $entries = @(Get-ChildItem -LiteralPath $unpacked -Force)
    $name = "open-kimi-web-$Revision"
    if ($entries.Count -ne 1 -or $entries[0].Name -ne $name -or -not $entries[0].PSIsContainer) {
        throw 'Repository archive has an unexpected top-level layout.'
    }
    $coordinator = Join-Path $entries[0].FullName 'scripts/install.mjs'
    if (-not (Test-Path -LiteralPath $coordinator -PathType Leaf)) { throw 'Selected revision has no install coordinator.' }
    return $coordinator
}

function Get-OkwArguments {
    param([string[]] $Arguments)
    $revision = ''
    $forward = @()
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -ceq '--revision') {
            if ($revision -or ++$i -ge $Arguments.Count) { throw '--revision requires one full commit SHA.' }
            $revision = $Arguments[$i]
            if ($revision -cnotmatch '^[0-9a-fA-F]{40}$') { throw 'Revision must be a full 40-digit commit SHA.' }
        } else { $forward += $Arguments[$i] }
    }
    $help = $forward.Count -eq 1 -and ($forward[0] -ceq '--help' -or $forward[0] -ceq '-h')
    if (-not $help) {
        $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        for ($i = 0; $i -lt $forward.Count; $i++) {
            $argument = $forward[$i]
            if (-not $seen.Add($argument)) { throw 'duplicate installation option' }
            switch -CaseSensitive ($argument) {
                '--version' {
                    if (++$i -ge $forward.Count) { throw '--version requires a formal version, e.g. 2.3.1-r1' }
                    $version = $forward[$i] -creplace '^v', ''
                    $pattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-r([1-9]\d*))?$'
                    if ($version -cnotmatch $pattern) { throw '--version requires a formal version, e.g. 2.3.1-r1' }
                }
                '--no-integrate' { }
                '--switch-installation' { }
                default { throw 'unknown installation option; use --help' }
            }
        }
    }
    return [pscustomobject] @{ Revision = $revision; Forward = $forward; Help = $help }
}

function Invoke-OkwInstall {
    param([string[]] $Arguments, [string] $ScriptDirectory)
    if ($PSVersionTable.PSVersion -lt [Version] '5.1') { throw 'PowerShell 5.1 or newer is required.' }
    try { $parsed = Get-OkwArguments $Arguments }
    catch { [Console]::Error.WriteLine($_.Exception.Message); return 2 }
    if ($parsed.Help) {
        Write-Host 'Usage: install.ps1 [--version <formal version>] [--switch-installation] [--no-integrate]'
        Write-Host '       [--revision <40-digit commit SHA>]'
        return 0
    }
    $revision = $parsed.Revision
    $forward = $parsed.Forward
    $platform = Get-OkwPlatform
    $homePath = $env:OPEN_KIMI_WEB_HOME
    if (-not $homePath) { $homePath = Join-Path $HOME '.open-kimi-web' }
    $homePath = [IO.Path]::GetFullPath($homePath)
    Assert-OkwDirectory $homePath
    $selected = $null
    $commands = @(Get-Command node -CommandType Application -ErrorAction SilentlyContinue)
    foreach ($command in $commands) {
        $selected = Get-OkwNodeInfo $command.Source
        if ($selected) { break }
    }
    if (-not $selected) { $selected = Get-OkwPrivateNode $homePath $platform }
    if (-not $selected) { throw 'Unable to verify the selected Node runtime.' }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('open-kimi-web-install-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    try {
        $coordinator = Get-OkwCoordinator $ScriptDirectory $revision $temporary
        & $selected.Node $coordinator @forward | Out-Host
        return $LASTEXITCODE
    } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { exit (Invoke-OkwInstall $args $PSScriptRoot) }
    catch { [Console]::Error.WriteLine('Install failed: ' + $_.Exception.Message); exit 1 }
}
