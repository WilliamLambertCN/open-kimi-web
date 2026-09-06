import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installRcBlock,
  pickRcFile,
  prependWindowsPath,
  readWindowsUserPath,
  removeRcBlock,
  removeRcBlocks,
  removeWindowsPathEntry,
  renderRcBlock,
  upsertRcBlock,
  windowsPathHasEntry,
  writeWindowsUserPath,
} from '../../src/integration/pathInstall.mjs';

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'okw-rc-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('rc marker block', () => {
  it('appends to an empty and a non-newline-terminated rc file', () => {
    expect(upsertRcBlock('', '/w/bin')).toBe(renderRcBlock('/w/bin'));
    const withContent = upsertRcBlock('export X=1', '/w/bin');
    expect(withContent).toBe(`export X=1\n${renderRcBlock('/w/bin')}`);
  });

  it('updates an existing block instead of duplicating it', () => {
    const once = upsertRcBlock('export X=1\n', '/w/bin');
    const twice = upsertRcBlock(once, '/w/bin');
    expect(twice).toBe(once);
    const moved = upsertRcBlock(once, '/other/bin');
    expect(moved.match(/# >>> open-kimi-web >>>/g)).toHaveLength(1);
    expect(moved).toContain('/other/bin');
    expect(moved).not.toContain('/w/bin');
  });

  it('removes exactly the marker block and nothing else', () => {
    const content = `export X=1\n${renderRcBlock('/w/bin')}alias k=kimi\n`;
    expect(removeRcBlock(content)).toBe('export X=1\nalias k=kimi\n');
    expect(removeRcBlock('export X=1\n')).toBeNull();
  });
});

describe('rc file selection and application', () => {
  it('prefers the first existing rc file, else falls back to ~/.profile', async () => {
    expect((await pickRcFile(home)).file).toBe(join(home, '.profile'));
    writeFileSync(join(home, '.zshrc'), '# zsh\n');
    writeFileSync(join(home, '.bashrc'), '# bash\n');
    expect((await pickRcFile(home)).file).toBe(join(home, '.bashrc'));
  });

  it('installRcBlock writes once and is idempotent', async () => {
    writeFileSync(join(home, '.bashrc'), '# bash\n');
    const first = await installRcBlock(home, '/w/bin');
    expect(first.changed).toBe(true);
    const second = await installRcBlock(home, '/w/bin');
    expect(second.changed).toBe(false);
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toContain('# >>> open-kimi-web >>>');
  });

  it('removeRcBlocks touches only files that carry the marker', async () => {
    writeFileSync(join(home, '.bashrc'), `# bash\n${renderRcBlock('/w/bin')}`);
    writeFileSync(join(home, '.zshrc'), '# zsh only\n');
    const touched = await removeRcBlocks(home);
    expect(touched).toEqual([join(home, '.bashrc')]);
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('# zsh only\n');
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe('# bash\n');
  });
});

describe('windows user PATH logic', () => {
  it('prepends exactly once, removing exact duplicates case-insensitively', () => {
    expect(prependWindowsPath('C:\\a;C:\\b', 'C:\\w\\bin')).toBe('C:\\w\\bin;C:\\a;C:\\b');
    expect(prependWindowsPath('C:\\a;c:\\W\\BIN;C:\\b', 'C:\\w\\bin')).toBe('C:\\w\\bin;C:\\a;C:\\b');
  });

  it('removes exact matches only, never prefixes', () => {
    expect(prependWindowsPath('C:\\w\\bin-extra', 'C:\\w\\bin')).toBe('C:\\w\\bin;C:\\w\\bin-extra');
    expect(removeWindowsPathEntry('C:\\w\\bin-extra;C:\\a', 'C:\\w\\bin')).toBeNull();
    expect(removeWindowsPathEntry('C:\\a;C:\\w\\bin;C:\\b', 'C:\\w\\bin')).toBe('C:\\a;C:\\b');
  });

  it('deduplicates trailing-backslash variants without changing kept entries', () => {
    expect(prependWindowsPath(' C:\\w\\bin\\ ;C:\\a\\', 'C:\\w\\bin')).toBe(
      'C:\\w\\bin;C:\\a\\',
    );
    expect(removeWindowsPathEntry('C:\\a; C:\\w\\bin\\ ;C:\\b', 'C:\\w\\bin')).toBe(
      'C:\\a;C:\\b',
    );
    expect(windowsPathHasEntry('C:\\a;C:\\W\\BIN\\', ' c:\\w\\bin ')).toBe(true);
  });
});

describe('windows user PATH powershell seam', () => {
  it('reads stdout and writes through an env var, failing on non-zero exit', async () => {
    const run = vi.fn(async (cmd, args, opts) => {
      if (opts?.env?.OPEN_KIMI_WEB_PATH_VALUE !== undefined) {
        expect(opts.env.OPEN_KIMI_WEB_PATH_VALUE).toBe('C:\\w\\bin;C:\\a');
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: 'C:\\a;C:\\b', stderr: '' };
    });
    expect(await readWindowsUserPath(run)).toBe('C:\\a;C:\\b');
    await writeWindowsUserPath('C:\\w\\bin;C:\\a', run);

    const failing = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'denied' }));
    await expect(readWindowsUserPath(failing)).rejects.toThrow(/user PATH/);
    await expect(writeWindowsUserPath('x', failing)).rejects.toThrow(/user PATH/);
  });

  it('forces UTF-8 and reads the raw unexpanded registry value', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '中文;%SystemRoot%\\bin', stderr: '' }));
    expect(await readWindowsUserPath(run, 'OPEN_KIMI_WEB_TEST_PATH')).toBe(
      '中文;%SystemRoot%\\bin',
    );
    const [, args, opts] = run.mock.calls[0];
    expect(args[2]).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8');
    expect(args[2]).toContain('DoNotExpandEnvironmentNames');
    expect(opts.env.OPEN_KIMI_WEB_PATH_NAME).toBe('OPEN_KIMI_WEB_TEST_PATH');
  });

  it('writes the registry directly and broadcasts with a bounded timeout', async () => {
    const calls = [];
    const run = vi.fn(async (...args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    });
    await writeWindowsUserPath('C:\\w\\bin', run);
    const [, psArgs, opts] = calls[0];
    expect(psArgs[2]).toContain('HKCU:\\Environment');
    expect(psArgs[2]).toContain('SendMessageTimeout');
    expect(psArgs[2]).not.toContain('SetEnvironmentVariable');
    expect(opts.timeoutMs).toBeGreaterThan(5_000);
  });
});
