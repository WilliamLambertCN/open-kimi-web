import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeInstallContext, runInstallProcess } from '../../scripts/install.mjs';
import { discoverOfficial, prepareOfficial } from '../../scripts/install/official.mjs';

const native = process.platform !== 'win32';
let root;
let python;
const entryBody = '# -*- coding: utf-8 -*-\nimport sys\nfrom kimi_cli.__main__ import main\n' +
  'if __name__ == "__main__":\n    if sys.argv[0].endswith("-script.pyw"):\n' +
  '        sys.argv[0] = sys.argv[0][:-11]\n    elif sys.argv[0].endswith(".exe"):\n' +
  '        sys.argv[0] = sys.argv[0][:-4]\n    sys.exit(main())\n';

beforeAll(async () => {
  if (!native) return;
  for (const path of ['/usr/bin/python3', '/usr/local/bin/python3']) {
    try { await access(path, constants.X_OK); python = await realpath(path); break; } catch {}
  }
  root = await mkdtemp(join(tmpdir(), 'okw-python-it-'));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function fixture(name, web = true) {
  const home = join(root, name);
  const bin = join(home, 'tools/bin');
  const module = join(bin, 'kimi_cli');
  await mkdir(module, { recursive: true });
  await writeFile(join(module, '__init__.py'), '');
  await writeFile(join(module, '__main__.py'), 'import sys\ndef main():\n' +
    `    print(${web ? '"kimi web --host --port"' : '"no web capability"'} if "web" in sys.argv else ` +
    '"kimi, version 1.51.0")\n');
  const entry = join(bin, 'kimi');
  await writeFile(entry, `#!${python}\n${entryBody}`);
  await chmod(entry, 0o755);
  const downloadOfficial = vi.fn(async () => { throw new Error('no official download expected'); });
  const ctx = makeInstallContext({ env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin', UV_TOOL_BIN_DIR: bin,
    OPEN_KIMI_WEB_HOME: join(home, '.open-kimi-web'), KIMI_CODE_HOME: join(home, '.kimi-code') },
  run: (command, args, settings) => runInstallProcess(command, args, { cwd: home, ...settings }),
  log: () => {}, downloadOfficial });
  return { entry, ctx, downloadOfficial };
}

describe.skipIf(!native)('POSIX Python console-entry fixture with a real interpreter', () => {
  it('discovers an off-PATH uv-shaped entry and reuses it without download or byte changes', async ({ skip }) => {
    if (!python) return skip();
    const { entry, ctx, downloadOfficial } = await fixture('reuse');
    const before = await readFile(entry);
    const found = await discoverOfficial(ctx);
    expect(found).toMatchObject({ path: entry, version: 'kimi, version 1.51.0' });
    await prepareOfficial(ctx, found, '/unused', {});
    expect(downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(entry)).toEqual(before);
  });

  it('rejects an injected line without executing it even for an explicit override', async ({ skip }) => {
    if (!python) return skip();
    const { entry, ctx, downloadOfficial } = await fixture('injected');
    const sentinel = join(dirname(entry), 'must-not-exist');
    await writeFile(entry, `#!${python}\n${entryBody}open(${JSON.stringify(sentinel)}, "w").write("bad")\n`);
    ctx.env.OPEN_KIMI_REAL_KIMI = entry;
    await expect(discoverOfficial(ctx)).rejects.toThrow('does not bypass identity');
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(downloadOfficial).not.toHaveBeenCalled();
  });

  it('refuses a missing interpreter rather than installing over an existing command', async ({ skip }) => {
    if (!python) return skip();
    const { entry, ctx, downloadOfficial } = await fixture('missing');
    await writeFile(entry, `#!${join(root, 'missing/python3')}\n${entryBody}`);
    await expect(discoverOfficial(ctx)).rejects.toThrow('repair its environment');
    expect(downloadOfficial).not.toHaveBeenCalled();
  });

  it('refuses a recognized entry whose actual Python module has no Web capability', async ({ skip }) => {
    if (!python) return skip();
    const { ctx, downloadOfficial } = await fixture('no-web', false);
    await expect(discoverOfficial(ctx)).rejects.toThrow('web command is unavailable');
    expect(downloadOfficial).not.toHaveBeenCalled();
  });
});
