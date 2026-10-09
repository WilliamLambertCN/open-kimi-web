import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runProcess } from '../src/update/process.mjs';

let directory;
let entry;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw-update-no-dependencies-'));
  const packageRoot = join(directory, 'launcher');
  await mkdir(packageRoot);
  await cp(new URL('../src', import.meta.url), join(packageRoot, 'src'), { recursive: true });
  await cp(new URL('../bin', import.meta.url), join(packageRoot, 'bin'), { recursive: true });
  await cp(new URL('../package.json', import.meta.url), join(packageRoot, 'package.json'));
  entry = join(packageRoot, 'bin/open-kimi-web.mjs');
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it('dispatches update help/argument errors/check without service dependencies or serve parsing', async () => {
  const help = await runProcess(process.execPath, [entry, 'update', '--help']);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain('update [--check | --help]');
  const invalid = await runProcess(process.execPath, [entry, 'update', '--force']);
  expect(invalid.code).toBe(2);
  const refused = await runProcess(process.execPath, [entry, 'update', '--check']);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('arbitrary extracted');
  expect(refused.stderr).not.toContain('dependencies are missing');
  const usage = await runProcess(process.execPath, [entry, '--help']);
  expect(usage.stdout).toContain('open-kimi-web update');
});
