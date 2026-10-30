import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathValue } from './environment.mjs';
import { pathStat } from './npm.mjs';
import { expandWindowsPath, windowsPaths } from './system.mjs';

function equal(left, right, platform) {
  const normalize = (value) => platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

function directories(value, platform) {
  const result = value.split(platform === 'win32' ? ';' : ':');
  if (result.length > 256) throw new Error('official command discovery PATH exceeds the bounded directory limit');
  return result.filter(Boolean).map((dir) => dir.replace(/^"(.*)"$/, '$1'));
}

function commandNames(ctx) {
  if (ctx.platform !== 'win32') return ['kimi'];
  const extensions = (ctx.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean);
  if (extensions.length > 32 || extensions.some((ext) => !/^\.[a-z0-9]+$/i.test(ext))) {
    throw new Error('unsupported PATHEXT for official command discovery; set OPEN_KIMI_REAL_KIMI');
  }
  return [...new Set([...extensions.map((ext) => `kimi${ext.toLowerCase()}`), 'kimi.ps1', 'kimi'])];
}

async function inDirectory(ctx, directory, first = true) {
  if ([ctx.bin, ctx.prefixBin].some((skip) => equal(directory, skip, ctx.platform))) return [];
  const found = [];
  for (const name of commandNames(ctx)) {
    const candidate = resolve(directory, name);
    if (!await pathStat(candidate)) continue;
    found.push(candidate);
    if (first) break;
  }
  return found;
}

async function canonical(candidate, ctx, target) {
  const entry = await pathStat(candidate) ? await target(candidate, ctx) : null;
  const path = await realpath(entry || candidate).catch(() => resolve(entry || candidate));
  return ctx.platform === 'win32' ? path.toLowerCase() : path;
}

async function explicitCandidate(ctx, target) {
  const override = ctx.env.OPEN_KIMI_REAL_KIMI;
  if (override !== undefined && (!override || !isAbsolute(override) || /[\r\n\0]/.test(override))) {
    throw new Error('OPEN_KIMI_REAL_KIMI must be an absolute path');
  }
  if (override && ctx.kimi && !equal(override, ctx.kimi, ctx.platform)) {
    const left = await canonical(override, ctx, target);
    const right = await canonical(ctx.kimi, ctx, target);
    if (left !== right) throw new Error('official override conflicts with integration');
  }
  return override || ctx.kimi;
}

function homeDirectories(ctx) {
  return ctx.platform === 'win32' ? [ctx.env.HOME, ctx.env.USERPROFILE] : [ctx.env.HOME || ctx.env.USERPROFILE];
}

function knownDirectories(ctx) {
  const env = ctx.env;
  const homes = homeDirectories(ctx);
  const dirs = [];
  for (const home of new Set(homes.filter(Boolean))) dirs.push(join(home, '.kimi-code/bin'), join(home, '.local/bin'));
  if (env.KIMI_INSTALL_DIR) dirs.push(join(env.KIMI_INSTALL_DIR, 'bin'));
  for (const key of ['UV_TOOL_BIN_DIR', 'XDG_BIN_HOME']) if (env[key]) dirs.push(env[key]);
  if (env.XDG_DATA_HOME) dirs.push(resolve(env.XDG_DATA_HOME, '../bin'));
  if (ctx.platform === 'win32' && env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  dirs.push(dirname(ctx.node));
  if (dirs.some((dir) => !isAbsolute(dir) || /[\r\n\0]/.test(dir))) {
    throw new Error('official command discovery directory must be an absolute safe path; set OPEN_KIMI_REAL_KIMI');
  }
  return dirs;
}

async function fallbackCandidate(ctx, owned, target) {
  const dirs = knownDirectories(ctx);
  if (ctx.platform === 'win32') {
    const paths = await (ctx.windowsPaths ?? windowsPaths)(ctx);
    for (const value of [paths.system, paths.user]) {
      dirs.push(...directories(expandWindowsPath(value ?? '', ctx.env), ctx.platform));
    }
  }
  const candidates = new Map();
  if (owned) candidates.set(await canonical(owned, ctx, target), owned);
  for (const dir of new Set(dirs)) {
    for (const candidate of await inDirectory(ctx, dir, false)) {
      const key = await canonical(candidate, ctx, target);
      if (!candidates.has(key)) candidates.set(key, candidate);
    }
  }
  if (candidates.size > 1) {
    throw new Error('multiple official Kimi installations outside the active PATH; set OPEN_KIMI_REAL_KIMI explicitly');
  }
  return candidates.values().next().value;
}

export async function findOfficialCandidate(ctx, owned, target) {
  const explicit = await explicitCandidate(ctx, target);
  if (explicit) return explicit;
  if (Object.keys(ctx.env).some((key) => /^BASH_FUNC_kimi(?:%%|\(\))$/.test(key))) {
    throw new Error('unsupported kimi shell function; set OPEN_KIMI_REAL_KIMI to an absolute executable');
  }
  const hint = ctx.env.OPEN_KIMI_INSTALL_COMMAND;
  if (hint) {
    if (!isAbsolute(hint)) throw new Error('unsupported shell command; set OPEN_KIMI_REAL_KIMI explicitly');
    return hint;
  }
  for (const dir of directories(pathValue(ctx.env, ctx.platform), ctx.platform)) {
    const [candidate] = await inDirectory(ctx, dir);
    if (candidate) return candidate;
  }
  return fallbackCandidate(ctx, owned, target);
}
