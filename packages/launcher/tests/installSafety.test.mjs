import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installerCommand, wrapperEntry } from '../../../scripts/install/wrappers.mjs';
import { persistInstallerPath, preflightPersistentPath,
  privateRuntimeDirectory } from '../../../scripts/install/persistentPath.mjs';
import { acquireInstallerUpdateLock } from '../../../scripts/install/updateLock.mjs';
import { assertNoSystemShadow } from '../../../scripts/install/system.mjs';
import { nodePathEnv, normalizePathEnv, pathValue } from '../../../scripts/install/environment.mjs';
import { isolatedNpmEnv } from '../../../scripts/install/npm.mjs';
import { makeInstallContext, runInstallProcess } from '../../../scripts/install.mjs';
import { renderCmdLauncher, renderCmdWrapper, renderShLauncher, renderShWrapper } from '../src/integration/wrapperGen.mjs';
import { acquireLock } from '../src/update/lock.mjs';

const roots = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "okw install quote' fixture-"));
  roots.push(home);
  const root = join(home, 'package');
  await mkdir(join(root, 'src/integration'), { recursive: true });
  await cp(new URL('../src/integration/pathInstall.mjs', import.meta.url), join(root, 'src/integration/pathInstall.mjs'));
  await cp(new URL('../src/integration/proc.mjs', import.meta.url), join(root, 'src/integration/proc.mjs'));
  return { home, root, bin: join(home, 'bin'), node: process.execPath, platform: 'linux',
    env: { HOME: home, SHELL: '/bin/zsh' }, log: () => {} };
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('canonical r9 wrapper ownership', () => {
  it.each(['linux', 'win32'])('matches executed node/entry/realKimi on %s and refuses comment forgery', (platform) => {
    const fields = { entry: join(tmpdir(), "owner's package/bin/open-kimi-web.mjs"),
      node: process.execPath, realKimi: join(tmpdir(), "official's kimi") };
    const state = { node: fields.node, realKimi: fields.realKimi };
    const render = platform === 'win32' ? renderCmdWrapper : renderShWrapper;
    const launcher = platform === 'win32' ? renderCmdLauncher : renderShLauncher;
    const text = render(fields);
    expect(wrapperEntry(text, state, { platform }, true)).toBe(fields.entry);
    expect(wrapperEntry(launcher(fields), state, { platform }, false)).toBe(fields.entry);
    const malicious = render({ ...fields, node: join(tmpdir(), 'untrusted-node') }) + `\n# ${fields.node}\n`;
    expect(wrapperEntry(malicious, state, { platform }, true)).toBeNull();
    expect(wrapperEntry(text.replace('OPEN_KIMI_REAL_KIMI=', 'OTHER='), state, { platform }, true)).toBeNull();
  });
});

describe('copyable selected-runtime commands', () => {
  it('uses PowerShell invocation and literal paths without JSON escaping', () => {
    const ctx = { platform: 'win32', node: "C:\\Node's $runtime\\node.exe", entry: "C:\\App's folder\\open-kimi-web.mjs" };
    const prefix = "& 'C:\\Node''s $runtime\\node.exe' 'C:\\App''s folder\\open-kimi-web.mjs'";
    expect(installerCommand(ctx, 'update')).toBe(`${prefix} update`);
    expect(installerCommand(ctx, 'integrate uninstall')).toBe(`${prefix} integrate uninstall`);
  });

  it('quotes POSIX apostrophes and prevents dollar or backtick expansion for package-only paths', () => {
    const ctx = { platform: 'linux', node: "/runtime's $node/bin/node", entry: '/app $HOME/`literal`/open-kimi-web.mjs' };
    const prefix = "'/runtime'\\''s $node/bin/node' '/app $HOME/`literal`/open-kimi-web.mjs'";
    expect(installerCommand(ctx, 'update')).toBe(`${prefix} update`);
    expect(installerCommand(ctx, 'integrate uninstall')).toBe(`${prefix} integrate uninstall`);
  });
});

describe('persistent installer PATH compatibility with r9', () => {
  it('moves only owned r9 marker from bashrc to zshrc, preserves content and supports apostrophes', async () => {
    const ctx = await fixture();
    const bashrc = join(ctx.home, '.bashrc');
    await writeFile(bashrc, `keep bash\n# >>> open-kimi-web >>>\nexport PATH="${ctx.bin}:$PATH"\n# <<< open-kimi-web <<<\n`);
    const next = await persistInstallerPath(ctx, { schema: 1, pathInstall: { kind: 'rc', file: bashrc } });
    expect(await readFile(bashrc, 'utf8')).toBe('keep bash\n');
    expect(await readFile(join(ctx.home, '.zshrc'), 'utf8')).toContain("'\\''");
    expect(next.pathInstall.file).toBe(join(ctx.home, '.zshrc'));
    await persistInstallerPath(ctx, next);
    expect((await readFile(join(ctx.home, '.zshrc'), 'utf8')).match(/# >>> open-kimi-web >>>/g)).toHaveLength(1);
  });

  it('refuses unrelated marker blocks without modifying shell files', async () => {
    const ctx = await fixture();
    const value = '# >>> open-kimi-web >>>\nexport PATH="/unrelated:$PATH"\n# <<< open-kimi-web <<<\n';
    await writeFile(join(ctx.home, '.zshrc'), value);
    await expect(persistInstallerPath(ctx, {})).rejects.toThrow('unrelated');
    expect(await readFile(join(ctx.home, '.zshrc'), 'utf8')).toBe(value);
  });

  it('adds bash interactive and default login paths without modifying custom login files', async () => {
    const ctx = await fixture();
    ctx.env.SHELL = '/bin/bash';
    await persistInstallerPath(ctx, {});
    expect(await readFile(join(ctx.home, '.bashrc'), 'utf8')).toContain('export PATH=');
    expect(await readFile(join(ctx.home, '.profile'), 'utf8')).toContain('export PATH=');
    await writeFile(join(ctx.home, '.bash_profile'), '');
    await expect(preflightPersistentPath(ctx, {})).rejects.toThrow('Bash login profile');
    await expect(persistInstallerPath(ctx, {})).rejects.toThrow('Bash login profile');
    expect(await readFile(join(ctx.home, '.bash_profile'), 'utf8')).toBe('');
    expect(await readFile(join(ctx.home, '.profile'), 'utf8')).toContain('export PATH=');
    const source = '# preserved login profile\nsource "$HOME/.bashrc"\n';
    await writeFile(join(ctx.home, '.bash_profile'), source);
    await preflightPersistentPath(ctx, {});
    await persistInstallerPath(ctx, {});
    expect(await readFile(join(ctx.home, '.bash_profile'), 'utf8')).toBe(source);
    expect(await readFile(join(ctx.home, '.profile'), 'utf8')).toBe('');
  });

  it('uses the highest-priority bash login profile and rejects empty or conditional source profiles', async () => {
    const ctx = await fixture();
    ctx.env.SHELL = '/bin/bash';
    await writeFile(join(ctx.home, '.bash_login'), '');
    await expect(preflightPersistentPath(ctx, {})).rejects.toThrow('~/.bash_login');
    await writeFile(join(ctx.home, '.bash_login'), '. ~/.bashrc\n');
    await preflightPersistentPath(ctx, {});
    for (const content of ['# source ~/.bashrc\n', 'false && source ~/.bashrc\n', 'exit\nsource ~/.bashrc\n']) {
      await writeFile(join(ctx.home, '.bash_profile'), content);
      await expect(preflightPersistentPath(ctx, {})).rejects.toThrow('~/.bash_profile');
      expect(await readFile(join(ctx.home, '.bash_profile'), 'utf8')).toBe(content);
    }
  });

  it('persists private runtime with wrapper-first User PATH using explicit test seams and readback', async () => {
    const ctx = await fixture();
    ctx.platform = 'win32';
    ctx.node = join(ctx.home, 'runtime/node/node.exe');
    await mkdir(dirname(ctx.node), { recursive: true });
    await writeFile(ctx.node, 'fixture executable');
    if (process.platform === 'win32') {
      expect(await privateRuntimeDirectory({ ...ctx, home: ctx.home.toUpperCase() })).toBe(dirname(ctx.node));
    }
    let userPath = 'preserve-other-entry';
    ctx.readUserPath = async () => userPath;
    ctx.writeUserPath = async (value) => { userPath = value; };
    ctx.gitBashPathDirectories = [join(ctx.home, 'runtime/git/cmd')];
    const state = await persistInstallerPath(ctx, {});
    expect(userPath.split(';')).toEqual([ctx.bin, dirname(ctx.node), ...ctx.gitBashPathDirectories, 'preserve-other-entry']);
    expect(state.bootstrapPathDirectories).toEqual(ctx.gitBashPathDirectories);
    expect(state.bootstrapRuntimeDirectory).toBe(dirname(ctx.node));
    ctx.windowsPaths = async () => ({ system: ctx.home, user: userPath });
    await writeFile(join(ctx.home, 'kimi.exe'), 'official fixture');
    await expect(assertNoSystemShadow(ctx)).rejects.toThrow('System PATH shadows');
  });
});

describe('Windows PATH environment normalization', () => {
  it('selects the same first case-insensitive PATH key as a Windows Node child', () => {
    const input = { path: 'lower', Path: 'mixed', PATH: 'selected', KEEP: 'value' };
    expect(pathValue(input, 'win32')).toBe('selected');
    expect(normalizePathEnv(input, 'win32')).toEqual({ KEEP: 'value', PATH: 'selected' });
    expect(normalizePathEnv({ Path: 'mixed' }, 'win32')).toEqual({ PATH: 'mixed' });
    expect(normalizePathEnv(input, 'linux')).toEqual(input);
    expect(pathValue({ Path: 'mixed' }, 'linux')).toBe('');
    const env = isolatedNpmEnv(input, '/stage', process.execPath, 'win32');
    expect(env.PATH).toBe(`${dirname(process.execPath)};selected`);
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    const ctx = makeInstallContext({ platform: 'win32', env: { ...input, OPEN_KIMI_WEB_HOME: tmpdir() } });
    expect(ctx.env.PATH).toBe('selected');
    expect(ctx.env.Path).toBeUndefined();
  });

  it('passes only the normalized selected-Node PATH to a real child without installing anything', async () => {
    const input = { ...process.env, PATH: 'selected fixture path', Path: 'wrong mixed path', path: 'wrong lower path' };
    const env = nodePathEnv(input, process.execPath);
    const actual = await runInstallProcess(process.execPath, ['-e', 'console.log(process.env.PATH)'], { env });
    expect(actual).toBe(env.PATH);
    expect(actual.startsWith(dirname(process.execPath))).toBe(true);
    const direct = await runInstallProcess(process.execPath, ['-e', 'console.log(process.env.PATH)'], { env: input });
    expect(direct).toBe('selected fixture path');
    if (process.platform === 'win32') {
      expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    }
  });
});

describe('bootstrap and updater lock handshake', () => {
  it('uses identical updater lock identity and blocks both directions', async () => {
    const ctx = await fixture();
    ctx.prefix = join(ctx.home, 'npm');
    ctx.platform = process.platform;
    const release = await acquireInstallerUpdateLock(ctx, false);
    await expect(acquireLock({ prefix: ctx.prefix })).rejects.toThrow('update lock');
    await release();
    await mkdir(join(ctx.root, 'src/update'), { recursive: true });
    await cp(new URL('../src/update/lock.mjs', import.meta.url), join(ctx.root, 'src/update/lock.mjs'));
    const reinstall = await acquireInstallerUpdateLock(ctx, true);
    await expect(acquireLock({ prefix: ctx.prefix })).rejects.toThrow('update lock');
    await reinstall();
    const updater = await acquireLock({ prefix: ctx.prefix });
    try { await expect(acquireInstallerUpdateLock(ctx, false)).rejects.toThrow('update lock'); }
    finally { await updater(); }
  });
});
