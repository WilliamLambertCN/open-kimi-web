import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareInstaller } from '../../scripts/prepare-installer.mjs';
import { git, projectRoot, put } from './updateFixture.mjs';

const { version } = JSON.parse(await readFile(join(projectRoot, 'packages/launcher/package.json'), 'utf8'));
const name = `open-kimi-web-${version}.tgz`;
const proxy = 'https://ghfast.top';
const release = `https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v${version}`;
const packageBytes = 'verified package fixture';
const packageDigest = createHash('sha256').update(packageBytes).digest('hex');
const shells = process.platform === 'win32' ? ['sh', 'ps1'] : ['sh'];
let root;
let output;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'okw-bootstrap-'));
  const repo = join(root, 'release');
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Release fixture']);
  await git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await cp(join(projectRoot, 'scripts/install'), join(repo, 'scripts/install'), { recursive: true });
  await cp(join(projectRoot, 'packages/launcher/src/update'), join(repo, 'packages/launcher/src/update'), { recursive: true });
  for (const file of ['LICENSE', 'scripts/install.mjs', 'packages/launcher/package.json']) {
    await cp(join(projectRoot, file), join(repo, file));
  }
  await put(join(repo, 'scripts/install.sh'), 'printf "%s\\n" "$@" "${OPEN_KIMI_WEB_GITHUB_PROXY:-}" ' +
    '"$OPEN_KIMI_WEB_INSTALL_SHA256" >"$FIXTURE_RECORD"\nexit "${FIXTURE_EXIT:-0}"\n');
  await put(join(repo, 'scripts/install.ps1'), 'function Invoke-OkwInstall($options, $directory) {\n' +
    '  $values = @([string] $env:OPEN_KIMI_WEB_GITHUB_PROXY, $env:OPEN_KIMI_WEB_INSTALL_SHA256)\n' +
    '  [IO.File]::WriteAllLines($env:FIXTURE_RECORD, [string[]] ($options + $values))\n' +
    '  return [int] $env:FIXTURE_EXIT\n}\n');
  await put(join(repo, 'docs/plans/private.md'), 'NOT_IN_RELEASE_FIXTURE');
  await put(join(repo, 'AGENTS.md'), 'NOT_IN_RELEASE_FIXTURE');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'isolated installer fixture']);
  const revision = await git(repo, ['rev-parse', 'HEAD']);
  const archive = join(root, name);
  await put(archive, packageBytes);
  output = join(root, 'out');
  await git(repo, ['config', 'core.autocrlf', 'true']);
  await prepareInstaller({ revision, archive, output, repo });
}, 30_000);

afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function unix(path) {
  return process.platform === 'win32' ? path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
    .replaceAll('\\', '/') : path;
}

const powershellCurl = `function curl.exe {
  $url = $args[-1]
  $out = $args[[array]::IndexOf($args, '--output') + 1]
  $seconds = $args[[array]::IndexOf($args, '--max-time') + 1]
  $redirects = if ($args -contains '--location') { 'follow' } else { 'direct' }
  Add-Content -LiteralPath $env:FIXTURE_CALLS -Value "$url|$seconds|$redirects"
  $mode = if ($url.StartsWith('https://ghfast.top/')) { $env:FIXTURE_PROXY } else { $env:FIXTURE_GITHUB }
  $global:LASTEXITCODE = 0
  switch ($mode) {
    'timeout' { $global:LASTEXITCODE = 28 }
    'corrupt' { Set-Content -LiteralPath $out -Value 'bad archive'; '200' }
    'redirect' { Copy-Item -LiteralPath $env:FIXTURE_ARCHIVE -Destination $out; '302' }
    'ok' { Copy-Item -LiteralPath $env:FIXTURE_ARCHIVE -Destination $out; '200' }
  }
}
`;

const shCurl = `#!/bin/sh
redirects=direct
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) shift; file=$1 ;;
    --max-time) shift; seconds=$1 ;;
    --location) redirects=follow ;;
    https://*) url=$1 ;;
  esac
  shift
done
printf '%s|%s|%s\\n' "$url" "$seconds" "$redirects" >>"$FIXTURE_CALLS"
case "$url" in https://ghfast.top/*) mode=$FIXTURE_PROXY ;; *) mode=$FIXTURE_GITHUB ;; esac
case "$mode" in
  timeout) exit 28 ;;
  corrupt) printf 'bad archive' >"$file"; printf 200 ;;
  redirect) cp "$FIXTURE_ARCHIVE" "$file"; printf 302 ;;
  ok) cp "$FIXTURE_ARCHIVE" "$file"; printf 200 ;;
esac
`;

async function fixture(extension, { setting, github = 'timeout', response = 'ok', exit = 0 } = {}) {
  const dir = await mkdtemp(join(root, 'run-'));
  const command = join(dir, `install-command.${extension}`);
  const record = join(dir, 'record');
  const calls = join(dir, 'calls');
  const filename = `okw-install-${version}.${extension === 'sh' ? 'tar.gz' : 'zip'}`;
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPEN_KIMI_WEB_GITHUB_PROXY$/i.test(key)));
  const vars = { ...inherited, OPEN_KIMI_WEB_INSTALL_SHA256: 'previous-pin-fixture',
    TMP: dir, TEMP: dir, TMPDIR: unix(dir), FIXTURE_EXIT: String(exit), FIXTURE_GITHUB: github, FIXTURE_PROXY: response };
  if (setting !== undefined) vars.OPEN_KIMI_WEB_GITHUB_PROXY = setting;
  const archive = join(output, filename);
  const url = `${release}/${filename}`;
  const script = join(output, `install-command.${extension}`);
  if (extension === 'ps1') {
    await writeFile(command, powershellCurl + await readFile(script, 'utf8'));
    const ps = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    return { dir, record, calls, url, run: () => spawnSync(ps,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', command],
      { env: { ...vars, FIXTURE_RECORD: record, FIXTURE_CALLS: calls, FIXTURE_ARCHIVE: archive },
        encoding: 'utf8', timeout: 15_000 }) };
  }
  await cp(script, command);
  await writeFile(join(dir, 'curl'), shCurl, { mode: 0o755 });
  return { dir, record, calls, url, run: () => spawnSync('sh',
    ['-c', 'PATH="$FIXTURE_BIN:$PATH"; export PATH; exec sh "$1"', 'fixture', unix(command)],
    { env: { ...vars, FIXTURE_BIN: unix(dir), FIXTURE_RECORD: unix(record), FIXTURE_CALLS: unix(calls),
      FIXTURE_ARCHIVE: unix(archive) }, encoding: 'utf8', timeout: 15_000 }) };
}

async function lines(file) { return (await readFile(file, 'utf8')).trimEnd().split(/\r?\n/); }

async function expectNoStage(dir) {
  expect((await readdir(dir)).some((entry) => entry.startsWith('okw-install-'))).toBe(false);
}

describe('pinned installer entry without preinstalled Node or GitHub codeload', () => {
  it('packages only the selected installer and helpers, retaining LF even with core.autocrlf enabled', async () => {
    const archive = unix(join(output, `okw-install-${version}.tar.gz`));
    const result = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('scripts/install.mjs');
    expect(result.stdout).toContain('packages/launcher/src/update/downloadProxy.mjs');
    expect(result.stdout).toContain('packages/launcher/src/update/windowsTreeCleanup.cs');
    expect(result.stdout).not.toMatch(/docs\/|AGENTS\.md|\.git|npmUpdate/);
    const entry = spawnSync('tar', ['-xOzf', archive, 'scripts/install.sh'], { encoding: 'utf8' });
    expect(entry.status, entry.stderr).toBe(0);
    expect(entry.stdout).toContain('\n');
    expect(entry.stdout).not.toContain('\r');
    expect((await readdir(output)).sort())
      .toEqual(['install-command.ps1', 'install-command.sh', `okw-install-${version}.tar.gz`, `okw-install-${version}.zip`]);
  });
  it.each(shells)('switches %s to the default proxy after the GitHub timeout without setting the variable', async (extension) => {
    const { dir, record, calls, url, run } = await fixture(extension);
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('via the GitHub download proxy');
    expect(await lines(record)).toEqual(['--version', version, '', packageDigest]);
    expect(await lines(calls)).toEqual([`${url}|2|follow`, `${proxy}/${url}|45|direct`]);
    await expectNoStage(dir);
  });
  it.each(shells)('does not call an explicitly disabled proxy in %s, even on a GitHub timeout', async (extension) => {
    const { dir, calls, url, run } = await fixture(extension, { setting: '0' });
    expect(run().status).toBe(1);
    expect(await lines(calls)).toEqual([`${url}|45|follow`]);
    expect(await readdir(dir)).not.toContain('record');
    await expectNoStage(dir);
  });
  it.each(shells)('does not call the proxy in %s when GitHub already supplied a verified installer', async (extension) => {
    const { dir, record, calls, url, run } = await fixture(extension, { github: 'ok' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(await lines(calls)).toEqual([`${url}|2|follow`]);
    expect(await lines(record)).toEqual(['--version', version, '', packageDigest]);
    await expectNoStage(dir);
  });
  it.each(shells.flatMap((shell) => ['corrupt', 'redirect'].map((mode) => [shell, mode])))
    ('refuses a %s proxy response of %s without executing it', async (extension, response) => {
      const { dir, calls, url, run } = await fixture(extension, { response });
      expect(run().status).toBe(1);
      expect(await readdir(dir)).not.toContain('record');
      expect(await lines(calls)).toEqual([`${url}|2|follow`, `${proxy}/${url}|45|direct`, `${url}|45|follow`]);
      await expectNoStage(dir);
    });
  it.each(shells)('rejects an unapproved proxy in %s before issuing network requests', async (extension) => {
    const { dir, run } = await fixture(extension, { setting: 'https://ghfast.top.example.invalid' });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPEN_KIMI_WEB_GITHUB_PROXY must be https://ghfast.top');
    expect(await readdir(dir)).not.toContain('calls');
    await expectNoStage(dir);
  });
  it('removes the PowerShell coordinator even when installation fails', async ({ skip }) => {
    if (process.platform !== 'win32') return skip();
    const { dir, record, run } = await fixture('ps1', { exit: 7 });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The installer did not complete.');
    expect(await lines(record)).toEqual(['--version', version, '', packageDigest]);
    await expectNoStage(dir);
  });
});
