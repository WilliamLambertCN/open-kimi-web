import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { localCaPaths } from '../src/tls/localCaFiles.mjs';
import { TLS_USAGE, tlsMain } from '../src/tls/tlsMain.mjs';

const homes = [];
const execute = promisify(execFile);
const children = new Map();

function executeTls(args, home) {
  const env = { ...process.env, OPEN_KIMI_WEB_HOME: home, OPEN_KIMI_WEB_UI: 'invalid-fixture' };
  const bin = resolve('packages/launcher/bin/open-kimi-web.mjs');
  const execution = execute(process.execPath, [bin, 'tls', ...args], {
    env, timeout: 3000, killSignal: 'SIGKILL',
  });
  children.set(execution.child, execution);
  return execution.finally(() => children.delete(execution.child));
}

async function options() {
  const home = await mkdtemp(join(tmpdir(), 'okw-tls-cli-ut-'));
  homes.push(home);
  return { home, interfaces: {}, hostname: 'fixture', log: vi.fn(), error: vi.fn() };
}

afterEach(async () => {
  const active = [...children.entries()];
  for (const [child] of active) child.kill('SIGKILL');
  await Promise.allSettled(active.map(([, execution]) => execution));
  expect(children.size).toBe(0);
  await Promise.all(homes.splice(0).map((home) => rm(home, { force: true, recursive: true })));
});

describe('tls command', () => {
  it.each([[], ['--help'], ['setup', '--help'], ['status', '-h'], ['bogus', '--help']].map((argv) => ({ argv })))(
    'prints help without filesystem effects for $argv', async ({ argv }) => {
      const opts = await options();
      expect(await tlsMain(argv, opts)).toBe(0);
      expect(opts.log).toHaveBeenCalledWith(TLS_USAGE);
      expect(await readdir(opts.home)).toEqual([]);
    },
  );

  it.each([['bogus'], ['setup', '--host', 'localhost'], ['disable', 'extra'], ['--home', '/not-used']]
    .map((argv) => ({ argv })))(
    'rejects invalid arguments without side effects for $argv', async ({ argv }) => {
      const opts = await options();
      expect(await tlsMain(argv, opts)).toBe(2);
      expect(opts.error).toHaveBeenCalledWith(expect.stringContaining('invalid arguments'));
      expect(await readdir(opts.home)).toEqual([]);
    },
  );

  it('prints setup, public-only status and disable results without paths, SANs or private keys', async () => {
    const opts = await options();
    expect(await tlsMain(['setup'], opts)).toBe(0);
    const output = opts.log.mock.calls.flat().join('\n');
    expect(output).toMatch(/CA SHA-256: (?:[0-9A-F]{2}:){31}[0-9A-F]{2}/);
    expect(output).toContain('Restart the launcher yourself');
    expect(output).toContain('compare its SHA-256 fingerprint with this terminal');
    expect(output).toContain('No system trust was changed');
    expect(output).toContain('Windows ACLs');
    expect(output).not.toContain(opts.home);
    expect(output).not.toContain('PRIVATE KEY');
    expect(output).not.toContain('fixture');
    opts.log.mockClear();
    expect(await tlsMain(['status'], opts)).toBe(0);
    expect(opts.log.mock.calls.flat().join('\n')).toMatch(/^Local CA: enabled\nCA SHA-256:/);
    expect(await tlsMain(['disable'], opts)).toBe(0);
    expect(await tlsMain(['status'], opts)).toBe(0);
    expect(opts.log).toHaveBeenLastCalledWith('Local CA: disabled');
    await expect(stat(localCaPaths(opts.home).rootKey)).resolves.toBeDefined();
  });

  it('returns failure with an actionable sanitized message for corrupt CA', async () => {
    const opts = await options();
    await tlsMain(['setup'], opts);
    const paths = localCaPaths(opts.home);
    await writeFile(paths.rootKey, 'broken private key fixture');
    expect(await tlsMain(['setup'], opts)).toBe(1);
    expect(opts.error).toHaveBeenCalledWith(expect.stringContaining('restore the original CA'));
    expect(opts.error.mock.calls.flat().join('\n')).not.toContain(opts.home);
    expect(await readFile(paths.rootKey, 'utf8')).toBe('broken private key fixture');
  });

});

describe('tls process entry', () => {
  it('dispatches disabled status before strict serve parsing without creating the environment home', async () => {
    const opts = await options();
    const home = join(opts.home, 'absent');
    const status = await executeTls(['status'], home);
    expect(status.stdout.trim()).toBe('Local CA: disabled');
    expect(status.stderr).toBe('');
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('handles help and invalid arguments without creating either isolated home', async () => {
    const opts = await options();
    const helpHome = join(opts.home, 'help');
    const invalidHome = join(opts.home, 'invalid');
    const [help] = await Promise.all([
      executeTls(['setup', '--help'], helpHome),
      expect(executeTls(['invalid'], invalidHome)).rejects.toMatchObject({ code: 2, stdout: '' }),
    ]);
    expect(help.stdout).toContain('Usage: open-kimi-web tls');
    expect(help.stderr).toBe('');
    await expect(stat(helpHome)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(invalidHome)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('sets up the environment home and prints public-only instructions', async () => {
    const opts = await options();
    const home = join(opts.home, 'configured');
    const setup = await executeTls(['setup'], home);
    expect(setup.stdout).toContain('Local CA enabled.');
    expect(setup.stderr).toBe('');
    expect(setup.stdout).not.toContain(home);
    expect(setup.stdout).not.toContain('PRIVATE KEY');
    const status = { ...opts, home, log: vi.fn() };
    expect(await tlsMain(['status'], status)).toBe(0);
    expect(status.log.mock.calls.flat().join('\n')).toContain('Local CA: enabled');
  });

  it('prints enabled status from the configured environment home', async () => {
    const opts = await options();
    expect(await tlsMain(['setup'], opts)).toBe(0);
    const status = await executeTls(['status'], opts.home);
    expect(status.stdout).toContain('Local CA: enabled');
    expect(status.stdout).not.toContain(opts.home);
    expect(status.stdout).not.toContain('PRIVATE KEY');
    expect(status.stderr).toBe('');
  });

  it('disables the environment home without removing the original CA', async () => {
    const opts = await options();
    expect(await tlsMain(['setup'], opts)).toBe(0);
    const paths = localCaPaths(opts.home);
    const original = await readFile(paths.rootKey, 'utf8');
    const disabled = await executeTls(['disable'], opts.home);
    expect(disabled.stdout).toContain('Local CA disabled.');
    expect(disabled.stderr).toBe('');
    opts.log.mockClear();
    expect(await tlsMain(['status'], opts)).toBe(0);
    expect(opts.log).toHaveBeenLastCalledWith('Local CA: disabled');
    expect(await readFile(paths.rootKey, 'utf8')).toBe(original);
  });
});
