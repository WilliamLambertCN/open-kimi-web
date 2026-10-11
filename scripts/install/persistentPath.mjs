import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shQuote } from './wrappers.mjs';
import { runIntegrationCommand } from './official.mjs';

const START = '# >>> open-kimi-web >>>';
const END = '# <<< open-kimi-web <<<';
const BLOCK = /# >>> open-kimi-web >>>[\s\S]*?# <<< open-kimi-web <<<\n?/g;
const RC_NAMES = ['.bashrc', '.zshrc', '.profile'];

async function rcContent(file) {
  let stat;
  try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('shell rc is unsafe or too large');
  return readFile(file, 'utf8');
}

export async function privateRuntimeDirectory(ctx) {
  const runtime = resolve(ctx.home, 'runtime');
  const node = await realpath(ctx.node);
  const target = ctx.platform === 'win32' ? node.toLowerCase() : node;
  const root = ctx.platform === 'win32' ? runtime.toLowerCase() : runtime;
  if (!target.startsWith(`${root}${sep}`)) return null;
  const stat = await lstat(node);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('private Node runtime is not a regular executable');
  return dirname(node);
}

function rcBlock(bin, runtime) {
  const paths = [bin, ...(Array.isArray(runtime) ? runtime : [runtime])].filter(Boolean).join(':');
  return `${START}\nexport PATH=${shQuote(paths)}:"$PATH"\n${END}\n`;
}

function assertOwnedBlocks(content, bin, runtime, oldRuntime, extras = []) {
  const allowed = [`${START}\nexport PATH="${bin}:$PATH"\n${END}\n`, rcBlock(bin, runtime), rcBlock(bin, oldRuntime),
    rcBlock(bin, [runtime, ...extras])];
  for (const block of content.match(BLOCK) ?? []) {
    if (!allowed.includes(block.endsWith('\n') ? block : `${block}\n`)) {
      throw new Error('shell rc contains an unrelated integration marker; refusing overwrite');
    }
  }
}

export async function preflightPersistentPath(ctx, state) {
  if (ctx.platform === 'win32') return;
  const home = ctx.env.HOME || ctx.env.USERPROFILE;
  const runtime = await privateRuntimeDirectory(ctx);
  await shellTargets(ctx);
  for (const name of RC_NAMES) {
    const content = await rcContent(join(home, name));
    assertOwnedBlocks(content, ctx.bin, runtime, state?.bootstrapRuntimeDirectory,
      state?.bootstrapPathDirectories ?? []);
  }
}

async function shellTargets(ctx) {
  const home = ctx.env.HOME || ctx.env.USERPROFILE;
  const shell = basename(ctx.env.SHELL || 'sh');
  if (shell === 'zsh') return [join(home, '.zshrc')];
  if (shell !== 'bash') return [join(home, '.profile')];
  for (const name of ['.bash_profile', '.bash_login']) {
    const file = join(home, name);
    const exists = await lstat(file).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!exists) continue;
    const lines = (await rcContent(file)).split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    const source = /^(?:\.|source)\s+(?:~\/\.bashrc|"\$HOME\/\.bashrc"|"\$\{HOME\}\/\.bashrc");?$/;
    if (!lines.length || !lines.every((line) => source.test(line))) {
      throw new Error(`Bash login profile ~/${name} cannot be verified to load ~/.bashrc; ` +
        'use --no-integrate, or manually arrange an unconditional source ~/.bashrc in that profile and rerun. ' +
        'Only a simple source line plus comments is automatically supported; the profile was not changed');
    }
    return [join(home, '.bashrc')];
  }
  return [join(home, '.bashrc'), join(home, '.profile')];
}

function appendBlock(content, bin, runtime) {
  const separator = content && !content.endsWith('\n') ? '\n' : '';
  return `${content}${separator}${rcBlock(bin, runtime)}`;
}

async function persistPosix(ctx, state, runtime) {
  const home = ctx.env.HOME || ctx.env.USERPROFILE;
  const targets = await shellTargets(ctx);
  const changes = [];
  for (const name of RC_NAMES) {
    const file = join(home, name);
    const content = await rcContent(file);
    assertOwnedBlocks(content, ctx.bin, runtime[0], state.bootstrapRuntimeDirectory, runtime.slice(1));
    const cleaned = content.replace(BLOCK, '');
    const next = targets.includes(file) ? appendBlock(cleaned, ctx.bin, runtime) : cleaned;
    if (next !== content) changes.push({ file, content, next });
  }
  try {
    for (const change of changes) await writeFile(change.file, change.next, { mode: 0o600 });
  } catch (error) {
    for (const change of changes.reverse()) await writeFile(change.file, change.content).catch(() => {});
    throw error;
  }
  for (const target of targets) {
    if (!(await rcContent(target)).includes(rcBlock(ctx.bin, runtime))) {
      throw new Error('persistent shell PATH verification failed');
    }
  }
  return { kind: 'rc', file: targets[0] };
}

async function persistWindows(ctx, module, runtime) {
  const read = ctx.readUserPath ?? module.readWindowsUserPath;
  const write = ctx.writeUserPath ?? module.writeWindowsUserPath;
  let value = await read();
  for (const directory of runtime.filter(Boolean).toReversed()) value = module.prependWindowsPath(value, directory);
  value = module.prependWindowsPath(value, ctx.bin);
  if (value !== await read()) await write(value);
  const actual = await read();
  if (!module.windowsPathHasEntry(actual, ctx.bin)) throw new Error('persistent User PATH wrapper verification failed');
  if (runtime.filter(Boolean).some((directory) => !module.windowsPathHasEntry(actual, directory))) {
    throw new Error('persistent User PATH runtime verification failed');
  }
  return { kind: 'windows-user-path' };
}

export async function persistInstallerPath(ctx, state) {
  const module = await import(pathToFileURL(join(ctx.root, 'src/integration/pathInstall.mjs')).href);
  const runtime = await privateRuntimeDirectory(ctx);
  const extras = ctx.gitBashPathDirectories ?? [];
  const directories = [runtime, ...extras];
  const pathInstall = ctx.platform === 'win32'
    ? await persistWindows(ctx, module, directories) : await persistPosix(ctx, state, directories);
  const next = { ...state, pathInstall, bootstrapRuntimeDirectory: runtime, bootstrapPathDirectories: extras };
  await writeFile(join(ctx.home, 'integration.json'), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  if (ctx.platform === 'win32') {
    for (const directory of directories.filter(Boolean)) {
      ctx.log(`Dependency PATH entry retained after integrate uninstall; remove manually when no longer needed: ${directory}`);
    }
  }
  return next;
}

export function integrationOptions(ctx) {
  const run = async (command, args, options) => ({ code: 0, stdout: await runIntegrationCommand(ctx, command, args,
    { ...options, env: { ...options?.env, ...ctx.env } }), stderr: '' });
  return { env: { ...ctx.env, OPEN_KIMI_WEB_HOME: ctx.home, OPEN_KIMI_REAL_KIMI: ctx.kimi },
    log: ctx.log, error: ctx.log, run, readUserPath: ctx.readUserPath,
    writeUserPath: ctx.writeUserPath, readSystemPath: ctx.readSystemPath };
}
