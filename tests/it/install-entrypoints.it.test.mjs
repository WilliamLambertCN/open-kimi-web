import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url));
let root;
let isolated;
let record;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okw-entry-it-'));
  isolated = join(root, 'directory with spaces & symbols');
  record = join(root, 'record.json');
  mkdirSync(isolated);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function coordinator() {
  writeFileSync(join(isolated, 'install.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FIXTURE_RECORD, JSON.stringify({
  args: process.argv.slice(2), node: process.execPath, home: process.env.OPEN_KIMI_WEB_HOME,
  kimiCommand: process.env.OPEN_KIMI_INSTALL_COMMAND,
}));
console.log('fixture coordinator progress');
process.exit(Number(process.env.FIXTURE_EXIT || 0));
`);
}

function ps(args, extra = {}) {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return spawnSync(executable, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(isolated, 'install.ps1'), ...args,
  ], {
    encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, OPEN_KIMI_WEB_HOME: join(root, 'home'), FIXTURE_RECORD: record,
      OPEN_KIMI_REAL_KIMI: '', OPEN_KIMI_INSTALL_COMMAND: '', TEMP: root, TMP: root, ...extra,
    },
  });
}

function unix(path) {
  if (process.platform !== 'win32') return path;
  return path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/');
}

function fakeCommand(name, source) {
  writeFileSync(join(root, 'fake-bin', name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
}

function shell(args, extra = {}) {
  const pathPrefix = unix(join(root, 'fake-bin'));
  return spawnSync('sh', ['-c', 'PATH="$FIXTURE_BIN:$PATH"; export PATH; exec sh "$@"', 'fixture',
    unix(join(isolated, 'install.sh')), ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, OPEN_KIMI_WEB_HOME: unix(join(root, 'home')), TMPDIR: unix(root),
      FIXTURE_RECORD: unix(record), FIXTURE_ROOT: unix(root), FIXTURE_BIN: pathPrefix, ...extra,
    },
  });
}

function prepareShell() {
  copyFileSync(join(scripts, 'install.sh'), join(isolated, 'install.sh'));
  mkdirSync(join(root, 'fake-bin'));
  mkdirSync(join(root, 'lib/node_modules/npm/bin'), { recursive: true });
  writeFileSync(join(root, 'lib/node_modules/npm/bin/npm-cli.js'), 'fixture npm CLI');
  fakeCommand('uname', `case "$1" in -s) printf 'Linux\\n';; -m) printf 'x86_64\\n';; esac`);
  fakeCommand('getconf', 'printf "glibc 2.39\\n"');
  fakeCommand('curl', 'printf "unexpected network\\n" >&2; exit 91');
  fakeCommand('node', `
if [ "$1" = -p ]; then
  case "$2" in
    process.version) printf '%s\\n' "\${FIXTURE_NODE_VERSION:-v22.23.3}" ;;
    process.execPath) printf '%s\\n' "$FIXTURE_ROOT/fake-bin/node" ;;
  esac
elif [ "\${2:-}" = --version ] && [ "\${1##*/}" = npm-cli.js ]; then
  printf '10.9.4\\n'
else
  printf '%s\\n' "$@" >"$FIXTURE_RECORD"
  exit "\${FIXTURE_EXIT:-0}"
fi
`);
}

describe.skipIf(process.platform !== 'win32')('native PowerShell entrypoint invocation', () => {
  beforeEach(() => {
    copyFileSync(join(scripts, 'install.ps1'), join(isolated, 'install.ps1'));
    coordinator();
  });

  it('selects actual Node and forwards exact package-only args without reading persistent user PATH', () => {
    const result = ps(['--version', '2.1.1-r9', '--switch-installation', '--no-integrate']);
    expect(result.status, result.stderr).toBe(0);
    const seen = JSON.parse(readFileSync(record, 'utf8'));
    expect(seen.args).toEqual(['--version', '2.1.1-r9', '--switch-installation', '--no-integrate']);
    expect(seen.node.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(seen.home).toBe(join(root, 'home'));
    expect(result.stdout).toContain('Node runtime: using');
    expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
  });

  it('preserves coordinator failure exit status and cleans temporary source', () => {
    const result = ps(['--no-integrate'], { FIXTURE_EXIT: '7' });
    expect(result.status).toBe(7);
    expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
  });

  it('forwards an unknown ps1 path for read-only inspection without executing it or loading a user profile', () => {
    const tools = join(root, 'fake-bin');
    mkdirSync(tools);
    const script = join(tools, 'kimi.ps1');
    writeFileSync(script, 'throw "unknown script must never be executed"');
    const result = ps(['--no-integrate'], { PATH: `${tools};${process.env.PATH}` });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(record, 'utf8')).kimiCommand).toBe(script);
    expect(result.stdout).not.toContain('unknown script must never be executed');
  });

  it('refuses a mutable revision before any coordinator execution', () => {
    const result = ps(['--revision', 'main', '--no-integrate']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('full 40-digit commit SHA');
    expect(readdirSync(root)).not.toContain('record.json');
  });
});

describe('actual sh entrypoint under isolated fake platform and commands', () => {
  beforeEach(prepareShell);

  it('forwards arguments losslessly and removes its own temporary directory', () => {
    coordinator();
    const result = shell(['--version', 'v2.1.1-r9', '--no-integrate', '--switch-installation']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(record, 'utf8').trim().split('\n').slice(1)).toEqual([
      '--version', 'v2.1.1-r9', '--no-integrate', '--switch-installation',
    ]);
    expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
  });

  it('propagates coordinator failures and removes its own temporary directory', () => {
    coordinator();
    const result = shell(['--no-integrate'], { FIXTURE_EXIT: '7' });
    expect(result.status).toBe(7);
    expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
  }, 15_000);

  it.each(['v20.1.0', 'v22.18.99', 'v22.19.0-rc.1', 'v22.19.x'])
  ('rejects unsuitable %s Node and attempts only the official private runtime download', (version) => {
    coordinator();
    fakeCommand('curl', `printf '%s\\n' "$@" >"$FIXTURE_RECORD"; exit 91`);
    const result = shell(['--no-integrate'], { FIXTURE_NODE_VERSION: version });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Download failed');
    expect(readFileSync(record, 'utf8')).toContain('https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.gz');
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it.each(['v22.19.0', 'v24.0.0'])('reuses suitable %s with adjacent npm without download', (version) => {
    coordinator();
    const result = shell(['--no-integrate'], { FIXTURE_NODE_VERSION: version });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(record, 'utf8')).toContain('--no-integrate');
    expect(readdirSync(root)).not.toContain('home');
  });

  it('bootstraps when no executable Node is discoverable', () => {
    coordinator();
    fakeCommand('node', 'exit 127');
    const result = shell(['--no-integrate']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Download failed');
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it('rejects missing adjacent npm and cleans failed runtime download', () => {
    coordinator();
    rmSync(join(root, 'lib'), { recursive: true });
    const result = shell(['--no-integrate']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Download failed');
    expect(readdirSync(join(root, 'home/runtime'))).toEqual([]);
  });

  it('downloads all online modules from one revision and removes the source tree after coordinator failure', () => {
    const sha = 'c'.repeat(40);
    fakeCommand('curl', `
output=''
while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; output=$1; else url=$1; fi
    shift
done
case "$url" in
    */commits/main) printf '  "sha": "${sha}",\\n' >"$output" ;;
    */tar.gz/${sha}) cp "$FIXTURE_ROOT/source.tar.gz" "$output" ;;
    *) printf 'unexpected URL\\n' >&2; exit 1 ;;
esac
`);
    const archiveRoot = join(root, `open-kimi-web-${sha}`);
    mkdirSync(join(archiveRoot, 'scripts/install'), { recursive: true });
    writeFileSync(join(archiveRoot, 'scripts/install.mjs'), "import './install/module.mjs';");
    writeFileSync(join(archiveRoot, 'scripts/install/module.mjs'), 'fixture module');
    const archive = spawnSync('tar', ['-czf', unix(join(root, 'source.tar.gz')), '-C', unix(root),
      `open-kimi-web-${sha}`], { encoding: 'utf8' });
    expect(archive.status, archive.stderr).toBe(0);
    const result = shell(['--no-integrate'], { FIXTURE_EXIT: '7' });
    expect(result.status, result.stderr).toBe(7);
    expect(readFileSync(record, 'utf8')).toContain(`open-kimi-web-${sha}/scripts/install.mjs`);
    expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
  }, 15_000);
});

const invalidArguments = [
  ['--version'], ['--version', '--no-integrate'], ['--unknown'], ['--NO-INTEGRATE'],
  ['--no-integrate', '--no-integrate'], ['--switch-installation', '--switch-installation'],
  ['--version', '2.1.1-r9', '--version', '2.1.1-r9'], ['--help', '--no-integrate'],
  ['--version', '02.1.1'], ['--version', '2.1.1-r0'], ['--version', 'V2.1.1'],
];
const helpArguments = [['--help'], ['--revision', 'd'.repeat(40), '--help'], ['-h', '--revision', 'e'.repeat(40)]];

function expectNoBootstrap() {
  expect(readdirSync(root)).not.toContain('home');
  expect(readdirSync(root)).not.toContain('record.json');
  expect(readdirSync(root).some((name) => name.startsWith('open-kimi-web-install-'))).toBe(false);
}

describe.skipIf(process.platform !== 'win32')('PowerShell pre-download argument validation', () => {
  beforeEach(() => { copyFileSync(join(scripts, 'install.ps1'), join(isolated, 'install.ps1')); });

  it.each(helpArguments)('prints help without runtime or source acquisition: %j', (...args) => {
    const result = ps(args, { PATH: '' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: install.ps1');
    expectNoBootstrap();
  });

  it.each(invalidArguments)('rejects malformed arguments before bootstrap: %j', (...args) => {
    const result = ps(args, { PATH: '' });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toMatch(/version|unknown|duplicate/);
    expectNoBootstrap();
  });
});

describe('sh pre-download argument validation', () => {
  beforeEach(() => {
    prepareShell();
    fakeCommand('node', 'printf "node discovery must not run\\n" >&2; exit 91');
    fakeCommand('uname', 'printf "platform discovery must not run\\n" >&2; exit 91');
  });

  it.each(helpArguments)('prints help without runtime or source acquisition: %j', (...args) => {
    const result = shell(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: install.sh');
    expectNoBootstrap();
  });

  it.each(invalidArguments)('rejects malformed arguments before bootstrap: %j', (...args) => {
    const result = shell(args);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toMatch(/version|unknown|duplicate/);
    expectNoBootstrap();
  });
});
