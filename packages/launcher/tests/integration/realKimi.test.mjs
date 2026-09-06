import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalPath,
  isInsideWrapperDir,
  kimiCandidateNames,
  resolveRealKimi,
} from '../../src/integration/realKimi.mjs';

let dir;
let wrapperDir;
let officialDir;

const okRun = vi.fn(async () => ({ code: 0, stdout: 'kimi 1.2.3\n', stderr: '' }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'okw-realkimi-'));
  wrapperDir = join(dir, 'state', 'bin');
  officialDir = join(dir, 'official');
  mkdirSync(wrapperDir, { recursive: true });
  mkdirSync(officialDir, { recursive: true });
  okRun.mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(env) {
  return { env, platform: 'linux', wrapperDir, run: okRun };
}

describe('kimiCandidateNames', () => {
  it('covers Windows shims and the plain unix name', () => {
    expect(kimiCandidateNames('win32')).toEqual(['kimi.exe', 'kimi.cmd', 'kimi.bat', 'kimi']);
    expect(kimiCandidateNames('linux')).toEqual(['kimi']);
  });
});

describe('resolveRealKimi', () => {
  it('finds kimi on PATH and returns its canonical path and version', async () => {
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const real = await resolveRealKimi(options({ PATH: officialDir }));
    expect(real.path).toBe(await canonicalPath(join(officialDir, 'kimi')));
    expect(real.version).toBe('kimi 1.2.3');
  });

  it('skips candidates inside the wrapper directory (no self-recursion)', async () => {
    writeFileSync(join(wrapperDir, 'kimi'), '# wrapper\n');
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const real = await resolveRealKimi(options({ PATH: [wrapperDir, officialDir].join(delimiter) }));
    expect(real.path).toBe(await canonicalPath(join(officialDir, 'kimi')));
  });

  it('refuses when the wrapper is the only kimi in sight', async () => {
    writeFileSync(join(wrapperDir, 'kimi'), '# wrapper\n');
    await expect(resolveRealKimi(options({ PATH: wrapperDir }))).rejects.toThrow(
      /could not find the official kimi/,
    );
  });

  it('skips a broken PATH entry in favour of a later working one', async () => {
    const brokenDir = join(dir, 'broken');
    mkdirSync(brokenDir);
    writeFileSync(join(brokenDir, 'kimi'), '#!/bin/sh\n');
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn fail'))
      .mockResolvedValueOnce({ code: 0, stdout: 'kimi 9.9\n', stderr: '' });
    const real = await resolveRealKimi({
      ...options({ PATH: [brokenDir, officialDir].join(delimiter) }),
      run,
    });
    expect(real.version).toBe('kimi 9.9');
  });

  it('honours OPEN_KIMI_REAL_KIMI and rejects a self-referencing override', async () => {
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const real = await resolveRealKimi(
      options({ PATH: '', OPEN_KIMI_REAL_KIMI: join(officialDir, 'kimi') }),
    );
    expect(real.version).toBe('kimi 1.2.3');

    writeFileSync(join(wrapperDir, 'kimi'), '# wrapper\n');
    await expect(
      resolveRealKimi(options({ OPEN_KIMI_REAL_KIMI: join(wrapperDir, 'kimi') })),
    ).rejects.toThrow(/does not point at a working kimi/);
  });

  it('rejects a binary that identifies as the open-kimi-web wrapper', async () => {
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const run = vi.fn(async () => ({ code: 0, stdout: 'open-kimi-web wrapper\n', stderr: '' }));
    await expect(
      resolveRealKimi({
        env: { OPEN_KIMI_REAL_KIMI: join(officialDir, 'kimi') },
        platform: 'linux',
        wrapperDir,
        run,
      }),
    ).rejects.toThrow(/wrapper itself/);
  });

  it('rejects a candidate that fails --version', async () => {
    writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom' }));
    await expect(
      resolveRealKimi({
        env: { OPEN_KIMI_REAL_KIMI: join(officialDir, 'kimi') },
        platform: 'linux',
        wrapperDir,
        run,
      }),
    ).rejects.toThrow(/--version/);
  });
});

describe('isInsideWrapperDir', () => {
  it('matches the directory itself and children, not siblings', async () => {
    expect(await isInsideWrapperDir(join(wrapperDir, 'kimi'), wrapperDir)).toBe(true);
    expect(await isInsideWrapperDir(wrapperDir, wrapperDir)).toBe(true);
    expect(await isInsideWrapperDir(officialDir, wrapperDir)).toBe(false);
  });
});
