import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCapture } from '../../packages/launcher/src/integration/proc.mjs';
import { writeWrappers } from '../../packages/launcher/src/integration/wrapperGen.mjs';

const fakeKimi = fileURLToPath(new URL('../../packages/launcher/tests/integration/fakeKimi.mjs', import.meta.url));
const entry = fileURLToPath(new URL('../../packages/launcher/bin/open-kimi-web.mjs', import.meta.url));
const windows = process.platform === 'win32';
let root;
let cwd;
let command;
let env;
let official;
let original;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'okw-cli-delegate-'));
  cwd = join(root, 'project with spaces');
  const home = join(root, 'user-home');
  const officialBin = join(home, '.kimi-code', 'bin');
  const wrapperBin = join(root, 'wrapper-bin');
  mkdirSync(cwd);
  mkdirSync(officialBin, { recursive: true });
  official = join(officialBin, windows ? 'kimi.cmd' : 'kimi');
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  original = windows
    ? `@echo off\r\n"${process.execPath}" "${fakeKimi}" %*\r\nexit /b %ERRORLEVEL%\r\n`
    : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fakeKimi)} "$@"\n`;
  writeFileSync(official, original, { mode: 0o755 });
  await writeWrappers(wrapperBin, process.platform, { entry, realKimi: official, node: process.execPath });
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  Object.assign(env, {
    PATH: `${wrapperBin}${delimiter}${process.env[pathKey] || ''}`,
    HOME: home, USERPROFILE: home, KIMI_CODE_HOME: join(home, 'existing-kimi-data'),
    OPEN_KIMI_WEB_HOME: join(root, 'okw-home'), OPEN_KIMI_REAL_KIMI: 'must-be-replaced-by-wrapper',
    OPEN_KIMI_WEB_DEBUG_LOG: '1', FAKE_RECORD: join(root, 'record.json'), FAKE_MARKER: 'cli-environment-preserved',
    FAKE_FORCE_DELEGATE: '1', FAKE_EXIT_CODE: '7',
  });
  command = windows ? 'kimi.cmd' : 'kimi';
});

afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('generated kimi command preserves direct CLI use', () => {
  it.each([
    { name: 'interactive entry', argv: [] },
    { name: 'native debug option', argv: ['--debug'] },
    { name: 'prompt resembling a web option', argv: ['-p', '--debug-log'] },
    { name: 'resume and assigned option', argv: ['--resume', 'fixture session', '--debug-log=trace'] },
    { name: 'non-web subcommand', argv: ['remote', '--scheduled-tasks'] },
    { name: 'literal after option separator', argv: ['--', '--scheduled-tasks=false'] },
  ])('$name uses the original executable and preserves arguments, cwd, home and exit code', async ({ argv }) => {
    const result = await runCapture(command, argv, { env, cwd });
    expect(result).toEqual({ code: 7, stdout: '', stderr: '' });
    expect(JSON.parse(readFileSync(env.FAKE_RECORD, 'utf8'))).toMatchObject({
      argv, cwd, kimiHome: env.KIMI_CODE_HOME, marker: 'cli-environment-preserved',
    });
    expect(readFileSync(official, 'utf8')).toBe(original);
  });

  it('prints the original CLI version through a new shell PATH', async () => {
    const result = await runCapture(command, ['--version'], { env, cwd });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('kimi 9.9.9-fake');
    expect(result.stderr).toBe('');
  });
});
