import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSpawnTarget, runCapture, spawnMirror } from '../../src/integration/proc.mjs';

const isWin = process.platform === 'win32';

describe('resolveSpawnTarget', () => {
  it('routes .cmd/.bat through cmd.exe on win32', () => {
    for (const name of ['C:\\bin\\kimi.cmd', 'C:\\bin\\kimi.bat']) {
      const target = resolveSpawnTarget(name, ['--version'], 'win32');
      expect(target.cmd).toBe('cmd.exe');
      expect(target.args.slice(0, 2)).toEqual(['/d', '/c']);
      // The whole line is wrapped in outer quotes for cmd to strip.
      expect(target.args[2]).toBe(`"${name} --version"`);
      expect(target.verbatim).toBe(true);
    }
  });

  it('quotes tokens with spaces or cmd metacharacters', () => {
    const target = resolveSpawnTarget('C:\\my bin\\kimi.cmd', ['a b', 'x&y'], 'win32');
    expect(target.args[2]).toBe('""C:\\my bin\\kimi.cmd" "a b" "x&y""');
  });

  it('leaves non-script commands untouched on win32', () => {
    expect(resolveSpawnTarget('C:\\bin\\kimi.exe', ['--version'], 'win32')).toEqual({
      cmd: 'C:\\bin\\kimi.exe',
      args: ['--version'],
      verbatim: false,
    });
  });

  it('never rewrites commands off win32', () => {
    expect(resolveSpawnTarget('/usr/bin/kimi', ['--version'], 'linux')).toEqual({
      cmd: '/usr/bin/kimi',
      args: ['--version'],
      verbatim: false,
    });
  });
});

describe('runCapture on win32 .cmd scripts', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'okw-proc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!isWin)('spawns a real .cmd and captures its output', async () => {
    const script = join(dir, 'echo.cmd');
    writeFileSync(script, '@echo off\r\necho hello-%1\r\n');
    const result = await runCapture(script, ['world']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello-world');
  });
});

describe('spawnMirror signal handling', () => {
  it('does not add force-kill signal forwarding on win32', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const { exited } = spawnMirror(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], {
      platform: 'win32',
    });
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
    await exited;
  });

  it('removes forwarding listeners when spawn fails', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const { exited } = spawnMirror(join(tmpdir(), `missing-kimi-${Date.now()}`), [], {
      platform: 'linux',
    });
    await expect(exited).rejects.toThrow();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});
