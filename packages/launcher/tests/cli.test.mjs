// cli.mjs is process entry glue and excluded from coverage thresholds, but
// the --version precheck that skills/open-kimi-web/SKILL.md relies on is
// worth a direct assertion: the flag must print the package version without
// falling through to parseArgs (which would exit 2 as an unknown command).
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { run } from '../src/cli.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const argv = (...args) => ['node', 'open-kimi-web', ...args];

describe('cli --version', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it.each(['--version', '-v'])('prints the package version for %s', async (flag) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(argv(flag));
    expect(log).toHaveBeenCalledWith(pkg.version);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

describe('cli without installed launcher dependencies', () => {
  let root;
  let stateHome;
  let entry;
  let env;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'okw-bare-cli-'));
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const bareRoot = join(root, 'launcher');
    stateHome = join(root, 'state');
    cpSync(join(sourceRoot, 'bin'), join(bareRoot, 'bin'), { recursive: true });
    cpSync(join(sourceRoot, 'src'), join(bareRoot, 'src'), { recursive: true });
    copyFileSync(join(sourceRoot, 'package.json'), join(bareRoot, 'package.json'));
    entry = join(bareRoot, 'bin', 'open-kimi-web.mjs');
    env = { ...process.env, OPEN_KIMI_WEB_HOME: stateHome };
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  afterEach(() => {
    expect(existsSync(join(stateHome, 'integration.json'))).toBe(false);
    expect(existsSync(join(stateHome, 'bin'))).toBe(false);
  });

  const invoke = (...args) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env });

  it('reports integration status without installed dependencies', () => {
    const result = invoke('integrate', 'status');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('integration is not installed');
  });

  it('uninstalls integration without installed dependencies', () => {
    const result = invoke('integrate', 'uninstall');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('integration uninstalled');
  });

  it.each(['install', 'repair'])('rejects integration %s without installed dependencies', (command) => {
    const result = invoke('integrate', command);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/Integration was not changed.*launcher dependencies are missing: ws, selfsigned/s);
  });

  it('rejects serve with a readable dependency error', () => {
    const result = invoke('serve');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/launcher dependencies are missing: ws, selfsigned/);
  });

  it('delegates non-web invocations without installed dependencies', () => {
    const result = spawnSync(process.execPath, [entry, '__wrap', '--version'], {
      encoding: 'utf8',
      env: { ...env, OPEN_KIMI_REAL_KIMI: process.execPath },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(process.version);
  });
});
