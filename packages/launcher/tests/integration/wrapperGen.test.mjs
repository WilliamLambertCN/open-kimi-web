import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isOurWrapper,
  renderCmdLauncher,
  renderCmdWrapper,
  renderShLauncher,
  renderShWrapper,
  WRAPPER_MARKER,
  writeWrappers,
} from '../../src/integration/wrapperGen.mjs';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'okw-wrapper-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const context = {
  entry: '/opt/open-kimi-web/bin/open-kimi-web.mjs',
  realKimi: '/opt/kimi/bin/kimi',
  node: '/usr/bin/node',
};

describe('renderShWrapper', () => {
  it('embeds absolute paths, exports the real kimi and never scans PATH for kimi', () => {
    const sh = renderShWrapper(context);
    expect(sh).toContain(WRAPPER_MARKER);
    expect(sh).toContain(`OPEN_KIMI_REAL_KIMI='${context.realKimi}'`);
    expect(sh).toContain(`exec '/usr/bin/node' '${context.entry}' __wrap "$@"`);
    expect(sh).toContain('command -v node');
    expect(sh).toContain('exit 127');
    expect(sh).not.toContain('which kimi');
  });

  it('sh-quotes single quotes in paths', () => {
    const sh = renderShWrapper({ ...context, realKimi: "/home/o'brien/kimi" });
    expect(sh).toContain("'\\''");
  });
});

describe('renderCmdWrapper', () => {
  it('prefers the recorded node, falls back to PATH node, errors clearly', () => {
    const cmd = renderCmdWrapper({
      entry: 'C:\\app\\open-kimi-web.mjs',
      realKimi: 'C:\\kimi\\kimi.exe',
      node: 'C:\\node\\node.exe',
    });
    expect(cmd).toContain(WRAPPER_MARKER);
    expect(cmd).toContain('set "OPEN_KIMI_REAL_KIMI=C:\\kimi\\kimi.exe"');
    expect(cmd).toContain('if exist "C:\\node\\node.exe"');
    expect(cmd).toContain('__wrap %*');
    expect(cmd).toContain('exit /b 127');
  });
});

describe('launcher commands (plain open-kimi-web on PATH)', () => {
  it('renders a sh launcher without the real kimi or __wrap', () => {
    const sh = renderShLauncher(context);
    expect(sh).toContain(WRAPPER_MARKER);
    expect(sh).toContain(`exec '/usr/bin/node' '${context.entry}' "$@"`);
    expect(sh).not.toContain('OPEN_KIMI_REAL_KIMI');
    expect(sh).not.toContain('__wrap');
  });

  it('renders a cmd launcher without the real kimi or __wrap', () => {
    const cmd = renderCmdLauncher({
      entry: 'C:\\app\\open-kimi-web.mjs',
      node: 'C:\\node\\node.exe',
    });
    expect(cmd).toContain(WRAPPER_MARKER);
    expect(cmd).toContain('"C:\\node\\node.exe" "C:\\app\\open-kimi-web.mjs" %*');
    expect(cmd).not.toContain('OPEN_KIMI_REAL_KIMI');
    expect(cmd).not.toContain('__wrap');
  });
});

describe('writeWrappers / isOurWrapper', () => {
  it('writes an executable unix wrapper that carries the marker', async () => {
    const files = await writeWrappers(dir, 'linux', context);
    expect(files).toEqual([join(dir, 'kimi'), join(dir, 'open-kimi-web')]);
    const content = await readFile(files[0], 'utf8');
    expect(content).toContain(WRAPPER_MARKER);
    expect(await isOurWrapper(files[0])).toBe(true);
    expect(await isOurWrapper(files[1])).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(files[0])).mode & 0o111).not.toBe(0);
      expect((await stat(files[1])).mode & 0o111).not.toBe(0);
    }
  });

  it('writes kimi.cmd on win32 with CRLF and rejects foreign files', async () => {
    const files = await writeWrappers(dir, 'win32', {
      entry: 'C:\\e.mjs',
      realKimi: 'C:\\k.cmd',
      node: 'C:\\n.exe',
    });
    expect(files[0].endsWith('kimi.cmd')).toBe(true);
    expect(files[1].endsWith('open-kimi-web.cmd')).toBe(true);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      // cmd.exe mis-parses LF-only batch files: every line must end CRLF.
      expect(content).not.toMatch(/(?<!\r)\n/);
      expect(await isOurWrapper(file)).toBe(true);
    }

    const foreign = join(dir, 'other');
    writeFileSync(foreign, '# not ours');
    expect(await isOurWrapper(foreign)).toBe(false);
    expect(await isOurWrapper(join(dir, 'missing'))).toBe(false);
  });
});
