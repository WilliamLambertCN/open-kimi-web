import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverOfficial, prepareOfficial } from '../../../scripts/install/official.mjs';

const roots = [];
const uvBody = 'import sys\nfrom kimi_cli.__main__ import main\nif __name__ == "__main__":\n' +
  '    if sys.argv[0].endswith("-script.pyw"):\n        sys.argv[0] = sys.argv[0][:-11]\n' +
  '    elif sys.argv[0].endswith(".exe"):\n        sys.argv[0] = sys.argv[0][:-4]\n    sys.exit(main())\n';
const pipBody = "import re\nimport sys\nfrom kimi_cli.__main__ import main\nif __name__ == '__main__':\n" +
  "    sys.argv[0] = re.sub(r'(-script\\.pyw|\\.exe)?$', '', sys.argv[0])\n    sys.exit(main())\n";
const simpleBody = 'import sys\nfrom kimi_cli.__main__ import main\nif __name__ == "__main__":\n    sys.exit(main())\n';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'okw-python-'));
  roots.push(home);
  const bin = join(home, 'tools/bin');
  await mkdir(bin, { recursive: true });
  const python = join(bin, 'python3');
  await writeFile(python, Buffer.from('7f454c460000', 'hex'));
  await chmod(python, 0o755);
  const kimi = join(bin, 'kimi');
  const ctx = { home, bin: join(home, 'takeover'), prefixBin: join(home, 'npm'), platform: 'linux', node: process.execPath,
    env: { PATH: '', HOME: home, UV_TOOL_BIN_DIR: bin }, downloadOfficial: vi.fn(), log: vi.fn(),
    run: vi.fn(async (_command, args) => args.includes('web') ? 'kimi web --host --port' : 'kimi, version 1.51.0') };
  return { ctx, kimi, python };
}
async function writeEntry(kimi, python, body = uvBody) {
  await writeFile(kimi, `#!${python}\n# -*- coding: utf-8 -*-\n${body}`);
  await chmod(kimi, 0o755);
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('bounded POSIX official Python console-entry identity', () => {
  it.each([['uv', uvBody], ['pip', pipBody], ['simple', simpleBody]])
  ('recognizes the exact %s main template without changing or downloading official files', async (_name, body) => {
    const { ctx, kimi, python } = await fixture();
    await writeEntry(kimi, python, body);
    const before = await readFile(kimi);
    const found = await discoverOfficial(ctx);
    await prepareOfficial(ctx, found, '/unused', {});
    expect(found.path).toBe(kimi);
    expect(ctx.run.mock.calls.map(([, args]) => args)).toEqual([['--version'], ['web', '--help']]);
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(kimi)).toEqual(before);
  });

  it('accepts the verified legacy cli entry and deduplicates its symlink aliases', async () => {
    const { ctx, kimi, python } = await fixture();
    const body = uvBody.replace('from kimi_cli.__main__ import main', 'from kimi_cli.cli import cli')
      .replace('sys.exit(main())', 'sys.exit(cli())');
    await writeEntry(kimi, python, body);
    const local = join(ctx.home, '.local/bin');
    await mkdir(local, { recursive: true });
    await symlink(kimi, join(local, 'kimi'));
    ctx.env.PATH = '';
    ctx.env.UV_TOOL_BIN_DIR = join(ctx.home, 'tools/bin');
    expect((await discoverOfficial(ctx)).path).toBe(join(local, 'kimi'));
  });

  it.each(['injected', 'substring', 'wrong-entry', 'arguments', 'env-python', 'oversized'])
  ('rejects %s Python wrappers even through override without executing or downloading them', async (kind) => {
    const { ctx, kimi, python } = await fixture();
    let body = uvBody;
    let interpreter = python;
    if (kind === 'injected') body += 'print("unexpected")\n';
    if (kind === 'substring') body = '# kimi_cli\nimport os\nos.system("unexpected")\n';
    if (kind === 'wrong-entry') body = body.replace('import main', 'import other');
    if (kind === 'arguments') interpreter += ' -I';
    if (kind === 'env-python') interpreter = '/usr/bin/env python3';
    if (kind === 'oversized') body += '#'.repeat(4096);
    await writeEntry(kimi, interpreter, body);
    ctx.env.OPEN_KIMI_REAL_KIMI = kimi;
    await expect(discoverOfficial(ctx)).rejects.toThrow(/unsupported|identity/);
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });

  it.each(['missing', 'non-native'])('refuses a %s Python interpreter before running the console entry', async (kind) => {
    const { ctx, kimi, python } = await fixture();
    if (kind === 'missing') await rm(python);
    else await writeFile(python, '#!/bin/sh\nexit 0\n');
    await writeEntry(kimi, python);
    await expect(discoverOfficial(ctx)).rejects.toThrow('repair its environment');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });

  it('still refuses a recognized entry without valid version or web capability', async () => {
    const { ctx, kimi, python } = await fixture();
    await writeEntry(kimi, python);
    ctx.run.mockResolvedValue('not official version');
    await expect(discoverOfficial(ctx)).rejects.toThrow('recognizable');
    ctx.run.mockImplementation(async (_command, args) => args.includes('web') ? 'deprecated CLI' : 'kimi, version 1.52.0');
    await expect(discoverOfficial(ctx)).rejects.toThrow('web command is unavailable');
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });
});
