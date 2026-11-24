& {
    $ErrorActionPreference = 'Stop'
    $version = '@VERSION@'
    $github = "https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v$version/okw-install-$version.zip"
    $defaultProxy = 'https://ghfast.top'
    $proxy = $env:OPEN_KIMI_WEB_GITHUB_PROXY
    if (-not $proxy) { $proxy = $defaultProxy }
    if ($proxy -ceq '0') { $proxy = '' }
    elseif ($proxy -cnotin @($defaultProxy, "$defaultProxy/")) {
        throw "OPEN_KIMI_WEB_GITHUB_PROXY must be $defaultProxy or 0 (disable)."
    }
    $digest = '@INSTALLER_SHA256@'
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('okw-install-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $archive = Join-Path $stage 'installer.zip'
    $previousDigest = $env:OPEN_KIMI_WEB_INSTALL_SHA256
    function Get-VerifiedInstaller([string] $url, [int] $seconds, [string[]] $redirects = @()) {
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
        $ErrorActionPreference = 'Continue'
        $status = & curl.exe -qfsS --proto '=https' --tlsv1.2 --max-time $seconds --max-filesize 2097152 `
            --output $archive --write-out '%{http_code}' @redirects $url 2>$null
        return ($LASTEXITCODE -eq 0 -and $status -ceq '200' -and
            (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $digest)
    }
    try {
        $env:OPEN_KIMI_WEB_INSTALL_SHA256 = '@PACKAGE_SHA256@'
        $follow = @('--location', '--proto-redir', '=https', '--max-redirs', '4')
        $ready = $false
        if ($proxy) {
            $ready = Get-VerifiedInstaller $github 2 $follow
            if (-not $ready) {
                $ready = Get-VerifiedInstaller ($proxy.TrimEnd('/') + '/' + $github) 45
                if ($ready) { Write-Host 'Installer: verified the archive downloaded via the GitHub download proxy.' }
            }
        }
        if (-not $ready) { $ready = Get-VerifiedInstaller $github 45 $follow }
        if (-not $ready) { throw 'Could not download a verified installer.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
        $installer = Join-Path $stage 'scripts/install.ps1'
        $source = [IO.File]::ReadAllText($installer)
        $status = & {
            . ([scriptblock]::Create($source))
            Invoke-OkwInstall @('--version', $version) (Split-Path -Parent $installer)
        }
        if ($status -ne 0) { throw 'The installer did not complete.' }
    } finally {
        $env:OPEN_KIMI_WEB_INSTALL_SHA256 = $previousDigest
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
