import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const psEntry = join(scripts, 'install.ps1');
const shellEntry = join(scripts, 'install.sh');
let root;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'okw-entry-ut-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function ps(body, extra = {}) {
  const runner = join(root, 'runner.ps1');
  writeFileSync(runner, `
$ErrorActionPreference = 'Stop'
. '${psEntry.replaceAll("'", "''")}'
try {
${body}
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`);
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, OPEN_KIMI_WEB_HOME: join(root, 'home'), OPEN_KIMI_REAL_KIMI: '',
      OPEN_KIMI_INSTALL_COMMAND: '', FIXTURE: root, ...extra },
  });
}

function unix(path) {
  if (process.platform !== 'win32') return path;
  return path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/');
}

function shell(body) {
  const runner = join(root, 'runner.sh');
  const source = readFileSync(shellEntry, 'utf8').replace(/\nokw_main "\$@"\s*$/, '\n');
  writeFileSync(runner, `${source}\n${body}\n`);
  return spawnSync('sh', [unix(runner)], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, OPEN_KIMI_WEB_HOME: unix(join(root, 'home')), FIXTURE: unix(root) },
  });
}

function expectFailure(result, message) {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
}

const windows = describe.skipIf(process.platform !== 'win32');

windows('PowerShell thin installer functions', () => {
  it.each(['AMD64', 'ARM64'])('detects native %s instead of WOW process architecture', (arch) => {
    const result = ps(`$env:PROCESSOR_ARCHITECTURE = 'x86'; $env:PROCESSOR_ARCHITEW6432 = '${arch}'; Get-OkwPlatform`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(arch === 'AMD64' ? 'win-x64' : 'win-arm64');
  });

  it('rejects an unsupported native architecture', () => {
    expectFailure(ps('Get-OkwPlatform', { PROCESSOR_ARCHITEW6432: 'x86' }), /Unsupported Windows/);
  });

  it('recognizes actual Node with its own adjacent npm and rejects missing Node', () => {
    const result = ps(`
$valid = Get-OkwNodeInfo '${process.execPath.replaceAll("'", "''")}'
if (-not $valid -or -not $valid.Npm.EndsWith('npm-cli.js')) { throw 'Actual Node not recognized' }
if (Get-OkwNodeInfo (Join-Path $env:FIXTURE 'missing.exe')) { throw 'Missing executable accepted' }
'accepted'
`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('accepted');
  });

  it('bootstraps when no Node is discovered', () => {
    const result = ps(`
function Get-Command { return @() }
function Get-OkwPrivateNode { param($InstallHome, $Platform); throw 'private runtime requested' }
Invoke-OkwInstall @('--no-integrate') $env:FIXTURE
`);
    expectFailure(result, /private runtime requested/);
  });

  it('rejects a real Node executable without its own adjacent npm', () => {
    const result = ps(`
$copy = Join-Path $env:FIXTURE 'node.exe'
Copy-Item -LiteralPath '${process.execPath.replaceAll("'", "''")}' -Destination $copy
if (Get-OkwNodeInfo $copy) { throw 'Unpaired npm accepted' }
'no npm rejected'
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('no npm rejected');
  });

  it.each(['v20.1.0', 'v22.18.99'])('rejects an actual %s executable probe', (version) => {
    const result = ps(`
$oldNode = Join-Path $env:FIXTURE 'old-node.exe'
$source = 'public class Probe { public static void Main() {
System.Console.WriteLine("{\\"version\\":\\"${version}\\",\\"path\\":\\"old-node.exe\\"}"); } }'
Add-Type -TypeDefinition $source -OutputAssembly $oldNode -OutputType ConsoleApplication
if (Get-OkwNodeInfo $oldNode) { throw 'Old Node accepted' }
'old node rejected'
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('old node rejected');
  });

  it.each(['v22.19.0', 'v24.0.0'])('accepts an actual %s probe with adjacent npm', (version) => {
    const path = process.execPath.replaceAll('\\', '/').replaceAll("'", "''");
    const result = ps(`
$fakeNode = Join-Path $env:FIXTURE 'node-probe.exe'
$source = 'public class Probe { public static void Main() {
System.Console.WriteLine("{\\"version\\":\\"${version}\\",\\"path\\":\\"${path}\\"}"); } }'
Add-Type -TypeDefinition $source -OutputAssembly $fakeNode -OutputType ConsoleApplication
if (-not (Get-OkwNodeInfo $fakeNode)) { throw 'Suitable Node rejected' }
'accepted'
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('accepted');
  });

  it.each(['--revision', '--revision main', '--revision 012345'])('rejects malformed arguments %s', (args) => {
    const array = args.split(' ').map((value) => `'${value}'`).join(', ');
    const result = ps(`exit (Invoke-OkwInstall @(${array}) $env:FIXTURE)`);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/revision|Revision/);
  });

});

windows('PowerShell official command hints', () => {
  it.each(['Function', 'Alias'])('rejects a kimi %s without executing it or discovering Node', (kind) => {
    const result = ps(`
function Get-Command { return [pscustomobject] @{ CommandType = '${kind}'; Source = 'unknown' } }
function Get-OkwPlatform { throw 'platform must not run' }
Invoke-OkwInstall @('--no-integrate') $env:FIXTURE
`);
    expectFailure(result, /Unsupported kimi alias\/function/);
  });

  it('passes only Application or ExternalScript paths for coordinator inspection without invoking them', () => {
    const result = ps(`
function Get-Command { return [pscustomobject] @{ CommandType = 'ExternalScript'; Source = 'C:\\fixture\\kimi.ps1' } }
Get-OkwKimiCommand
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('C:\\fixture\\kimi.ps1');
  });

  it('rejects arbitrary HTTP and nonofficial origins before calling web request', () => {
    const result = ps(`
function Invoke-WebRequest { throw 'request must not run' }
Invoke-OkwDownload 'https://example.test/node.zip' (Join-Path $env:FIXTURE 'download')
`);
    expectFailure(result, /approved HTTPS/);
  });

});

windows('PowerShell private runtime and immutable source', () => {
  it('does not overwrite an unknown existing runtime', () => {
    const result = ps(`
$destination = Join-Path $env:OPEN_KIMI_WEB_HOME 'runtime/node-v22.23.3-win-x64'
New-Item -ItemType Directory -Path $destination -Force > $null
Set-Content -LiteralPath (Join-Path $destination 'keep') -Value 'unknown'
Get-OkwPrivateNode $env:OPEN_KIMI_WEB_HOME 'win-x64'
`);
    expectFailure(result, /unrecognized/);
    expect(readFileSync(join(root, 'home/runtime/node-v22.23.3-win-x64/keep'), 'utf8')).toContain('unknown');
    expect(readdirSync(join(root, 'home/runtime'))).toEqual(['node-v22.23.3-win-x64']);
  });

  it('retains another installer lock without deleting it', () => {
    const result = ps(`
$runtime = Join-Path $env:OPEN_KIMI_WEB_HOME 'runtime'
New-Item -ItemType Directory -Path $runtime -Force > $null
Set-Content -LiteralPath (Join-Path $runtime 'node-v22.23.3-win-x64.lock') -Value 'other'
Get-OkwPrivateNode $env:OPEN_KIMI_WEB_HOME 'win-x64'
`);
    expectFailure(result, /locked/);
    expect(readdirSync(join(root, 'home/runtime'))).toEqual(['node-v22.23.3-win-x64.lock']);
  });

  it('checks the real SHA256 before extraction and cleans its staging and lock', () => {
    const result = ps(`
function Invoke-OkwDownload { param($Url, $Destination); Set-Content -LiteralPath $Destination -Value 'bad digest' }
function Expand-Archive { throw 'extraction must not run' }
Get-OkwPrivateNode $env:OPEN_KIMI_WEB_HOME 'win-x64'
`);
    expectFailure(result, /SHA256 mismatch/);
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it.each(['download', 'layout', 'version', 'extract'])('cleans failed %s staging without replacing a runtime', (phase) => {
    const result = ps(`
function Invoke-OkwDownload {
    param($Url, $Destination)
    if ($env:PHASE -eq 'download') { throw 'fixture download failed' }
    Set-Content -LiteralPath $Destination -Value 'fixture archive'
}
function Get-FileHash { return @{ Hash = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71' } }
function Expand-Archive {
    param($LiteralPath, $DestinationPath)
    if ($env:PHASE -eq 'extract') { throw 'fixture extract failed' }
    $name = if ($env:PHASE -eq 'layout') { 'wrong' } else { 'node-v22.23.3-win-x64' }
    New-Item -ItemType Directory -Path (Join-Path $DestinationPath $name) -Force > $null
}
Get-OkwPrivateNode $env:OPEN_KIMI_WEB_HOME 'win-x64'
`, { PHASE: phase });
    expectFailure(result, /failed|layout|invalid/);
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it('loads coordinator and split modules from one immutable archive', () => {
    const sha = 'a'.repeat(40);
    const result = ps(`
function Invoke-OkwDownload {
    param($Url, $Destination)
    if ($Url.EndsWith('/commits/main')) { Set-Content -LiteralPath $Destination -Value '{"sha":"${sha}"}' }
    elseif ($Url -eq 'https://codeload.github.com/WilliamLambertCN/open-kimi-web/zip/${sha}') {
        Set-Content -LiteralPath $Destination -Value 'source fixture'
    } else { throw 'unexpected mutable request' }
}
function Expand-Archive {
    param($LiteralPath, $DestinationPath)
    $scripts = Join-Path $DestinationPath 'open-kimi-web-${sha}/scripts'
    New-Item -ItemType Directory -Path (Join-Path $scripts 'install') -Force > $null
    Set-Content -LiteralPath (Join-Path $scripts 'install.mjs') -Value 'fixture'
    Set-Content -LiteralPath (Join-Path $scripts 'install/module.mjs') -Value 'same revision'
}
Get-OkwCoordinator '' '' $env:FIXTURE
`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`open-kimi-web-${sha}`);
  });

  it('rejects an invalid API commit before requesting source', () => {
    const result = ps(`
function Invoke-OkwDownload { param($Url, $Destination); Set-Content -LiteralPath $Destination -Value '{"sha":"main"}' }
Get-OkwCoordinator '' '' $env:FIXTURE
`);
    expectFailure(result, /invalid commit SHA/);
  });
});

windows('PowerShell help before bootstrap', () => {
  it('prints help without discovering or downloading Node', () => {
    const result = ps(`
function Get-OkwPlatform { throw 'platform must not run' }
function Get-OkwPrivateNode { throw 'bootstrap must not run' }
exit (Invoke-OkwInstall @('--help') $env:FIXTURE)
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: install.ps1');
  });
});

describe('POSIX thin installer functions', () => {
  it('prints help before platform detection or bootstrap', () => {
    const result = shell(`
okw_platform() { okw_fail 'platform must not run'; }
okw_private_node() { okw_fail 'bootstrap must not run'; }
okw_main --help
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: install.sh');
  });

  it('rejects an inherited kimi function before bootstrap and does not run it', () => {
    const result = shell(`
unset OPEN_KIMI_REAL_KIMI
kimi() { okw_fail 'unknown function must not run'; }
okw_platform() { okw_fail 'platform must not run'; }
okw_main --no-integrate
`);
    expectFailure(result, /Unsupported kimi shell command/);
  });

  it('rejects a mutable revision before creating the runtime', () => {
    const result = shell(`
okw_platform() { printf 'linux-x64\\n'; }
okw_private_node() { okw_fail 'bootstrap must not run'; }
okw_main --revision main
`);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/40-digit commit/);
    expect(readdirSync(root)).not.toContain('home');
  });

  it('parses under actual sh', () => {
    const result = spawnSync('sh', ['-n', unix(shellEntry)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it.each([
    ['Darwin', 'arm64', 'darwin-arm64'], ['Linux', 'x86_64', 'linux-x64'],
  ])('detects %s %s', (os, arch, expected) => {
    const result = shell(`
uname() { case "$1" in -s) printf '%s\\n' '${os}';; -m) printf '%s\\n' '${arch}';; esac; }
getconf() { printf 'glibc 2.39\\n'; }
okw_platform
`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });

  it.each(['musl', 'architecture', 'os'])('rejects unsupported %s', (mode) => {
    const result = shell(`
uname() { case "$1" in -s) printf '%s\\n' '${mode === 'os' ? 'FreeBSD' : 'Linux'}';;
-m) printf '%s\\n' '${mode === 'architecture' ? 'i686' : 'x86_64'}';; esac; }
getconf() { ${mode === 'musl' ? 'return 1' : "printf 'glibc 2.39\\n'"}; }
okw_platform
`);
    expectFailure(result, /Unsupported/);
  });

});

describe('POSIX runtime integrity and immutable source', () => {
  it('fails digest verification before tar extraction and cleans only its directories', () => {
    const result = shell(`
okw_download() { printf 'bad archive' >"$2"; }
tar() { okw_fail 'extraction must not run'; }
okw_private_node "$OPEN_KIMI_WEB_HOME" linux-x64
`);
    expectFailure(result, /SHA256 mismatch/);
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it('rejects arbitrary origins without a curl call', () => {
    expectFailure(shell('okw_download https://example.test/file "$FIXTURE/download"'), /approved HTTPS/);
  });

  it('rejects unsafe archive paths before extraction', () => {
    const result = shell(`
tar() { printf 'expected/../escape\\n'; }
okw_archive_layout fixture expected "$FIXTURE/listing"
`);
    expectFailure(result, /unsafe path/);
  });

  it('rejects malformed commit revisions before downloading', () => {
    expectFailure(shell('okw_coordinator "$FIXTURE" main "$FIXTURE"'), /40-digit commit/);
  });

  it('resolves main once and requests only the validated immutable commit archive', () => {
    const sha = 'b'.repeat(40);
    const result = shell(`
okw_download() {
    case "$1" in
        */commits/main) printf '  "sha": "${sha}",\\n' >"$2" ;;
        */tar.gz/${sha}) printf 'archive' >"$2" ;;
        *) okw_fail 'unexpected mutable request' ;;
    esac
}
tar() {
    case "$1" in
        -tzf) printf 'open-kimi-web-${sha}/scripts/install.mjs\\n' ;;
        -xzf) mkdir -p "$4/open-kimi-web-${sha}/scripts/install"
            printf fixture >"$4/open-kimi-web-${sha}/scripts/install.mjs" ;;
    esac
}
okw_coordinator "$FIXTURE/missing" '' "$FIXTURE"
`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain(`open-kimi-web-${sha}/scripts/install.mjs`);
  });
});
