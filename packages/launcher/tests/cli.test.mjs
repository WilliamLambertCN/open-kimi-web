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
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('routes integration commands before loading serve dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'okw-bare-cli-'));
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const bareRoot = join(root, 'launcher');
    const stateHome = join(root, 'state');
    cpSync(join(sourceRoot, 'bin'), join(bareRoot, 'bin'), { recursive: true });
    cpSync(join(sourceRoot, 'src'), join(bareRoot, 'src'), { recursive: true });
    copyFileSync(join(sourceRoot, 'package.json'), join(bareRoot, 'package.json'));
    const entry = join(bareRoot, 'bin', 'open-kimi-web.mjs');
    const env = { ...process.env, OPEN_KIMI_WEB_HOME: stateHome };
    const invoke = (...args) => spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8',
      env,
    });

    try {
      const status = invoke('integrate', 'status');
      expect(status.status).toBe(0);
      expect(status.stdout).toContain('integration is not installed');
      expect(invoke('integrate', 'uninstall').status).toBe(0);
      for (const command of ['install', 'repair']) {
        const result = invoke('integrate', command);
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toMatch(/Integration was not changed.*launcher dependencies are missing: ws, selfsigned/s);
      }
      const serve = invoke('serve');
      expect(serve.status).toBe(1);
      expect(serve.stderr).toMatch(/launcher dependencies are missing: ws, selfsigned/);
      const delegated = spawnSync(process.execPath, [entry, '__wrap', '--version'], {
        encoding: 'utf8',
        env: { ...env, OPEN_KIMI_REAL_KIMI: process.execPath },
      });
      expect(delegated.status, delegated.stderr).toBe(0);
      expect(delegated.stdout).toContain(process.version);
      expect(existsSync(join(stateHome, 'integration.json'))).toBe(false);
      expect(existsSync(join(stateHome, 'bin'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
