// `open-kimi-web integrate` orchestration: install / repair / uninstall.
// Reversibility rules: only files under the integration home and the exact
// rc marker block / exact User PATH entry we created are ever touched; every
// install step registers an undo action so a failure rolls back cleanly.
import { readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withIntegrationLock } from './lock.mjs';
import {
  installRcBlock,
  pickRcFile,
  prependWindowsPath,
  readWindowsSystemPath,
  readWindowsUserPath,
  removeRcBlock,
  removeRcBlocks,
  removeWindowsPathEntry,
  splitWindowsPath,
  windowsPathHasEntry,
  writeWindowsUserPath,
} from './pathInstall.mjs';
import { resolveRealKimi } from './realKimi.mjs';
import {
  integrationHome,
  integrationPaths,
  IntegrateError,
  loadState,
  makeState,
  removeState,
  saveState,
} from './state.mjs';
import { isOurWrapper, writeWrappers, wrapperFileNames } from './wrapperGen.mjs';

function launcherEntry() {
  return fileURLToPath(new URL('../../bin/open-kimi-web.mjs', import.meta.url));
}

async function launcherVersion() {
  const raw = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw).version;
}

async function wrappersIntact(paths, state) {
  const files = state.wrapperFiles ?? [];
  if (files.length === 0) return false;
  for (const name of files) {
    if (!(await isOurWrapper(join(paths.bin, name)))) return false;
  }
  return true;
}

async function pathInstallIntact(ctx) {
  if (ctx.platform === 'win32') {
    return windowsPathHasEntry(await ctx.readUserPath(), ctx.paths.bin);
  }
  const homeDir = ctx.env.HOME ?? ctx.env.USERPROFILE ?? '';
  const { content } = await pickRcFile(homeDir);
  return removeRcBlock(content) !== null;
}

/** Fail fresh installs when wrapper traces exist without a state file. */
async function detectExistingTrace(ctx) {
  if (ctx.platform === 'win32') {
    const current = await ctx.readUserPath();
    if (windowsPathHasEntry(current, ctx.paths.bin)) {
      throw new IntegrateError(
        'the wrapper directory is already on the user PATH but no state file exists; run `open-kimi-web integrate repair` or `uninstall`',
      );
    }
    return;
  }
  const homeDir = ctx.env.HOME ?? ctx.env.USERPROFILE ?? '';
  const { content } = await pickRcFile(homeDir);
  if (removeRcBlock(content) !== null) {
    throw new IntegrateError(
      'a shell rc marker block already exists but no state file does; run `open-kimi-web integrate repair` or `uninstall`',
    );
  }
}

async function wrapperBackups(paths, platform) {
  const backups = new Map();
  for (const name of wrapperFileNames(platform)) {
    const file = join(paths.bin, name);
    try {
      backups.set(file, await readFile(file));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      backups.set(file, null);
    }
  }
  return backups;
}

async function restoreWrappers(paths, backups) {
  for (const [file, content] of backups) {
    if (content === null) await rm(file, { force: true });
    else await writeFile(file, content);
  }
  if ([...backups.values()].every((content) => content === null)) {
    await rmdir(paths.bin).catch(() => undefined);
  }
}

async function installPath(ctx) {
  if (ctx.platform === 'win32') {
    const previous = await ctx.readUserPath();
    const next = prependWindowsPath(previous, ctx.paths.bin);
    if (next !== previous) await ctx.writeUserPath(next);
    return {
      record: { kind: 'windows-user-path' },
      undo: async () => {
        if (next !== previous) await ctx.writeUserPath(previous);
      },
    };
  }
  const homeDir = ctx.env.HOME ?? ctx.env.USERPROFILE;
  if (homeDir === undefined) throw new IntegrateError('HOME is not set; cannot edit the shell rc');
  const { file, content } = await pickRcFile(homeDir);
  await installRcBlock(homeDir, ctx.paths.bin);
  return {
    record: { kind: 'rc', file },
    undo: () => writeFile(file, content, 'utf8'),
  };
}

async function buildAndRecord(ctx, installedAt) {
  const real = await resolveRealKimi({
    env: ctx.env,
    platform: ctx.platform,
    wrapperDir: ctx.paths.bin,
    run: ctx.run,
  });
  const wrapperContext = { entry: launcherEntry(), realKimi: real.path, node: process.execPath };
  const undo = [];
  try {
    const backups = await wrapperBackups(ctx.paths, ctx.platform);
    undo.push(() => restoreWrappers(ctx.paths, backups));
    await writeWrappers(ctx.paths.bin, ctx.platform, wrapperContext);
    const pathInstall = await installPath(ctx);
    undo.push(pathInstall.undo);
    const state = makeState({
      realKimi: real.path,
      realKimiVersion: real.version,
      node: process.execPath,
      wrapperDir: ctx.paths.bin,
      wrapperFiles: wrapperFileNames(ctx.platform),
      pathInstall: pathInstall.record,
      installedAt,
      launcherVersion: await launcherVersion(),
    });
    await saveState(ctx.paths, state);
    undo.push(() => removeState(ctx.paths));
    return state;
  } catch (error) {
    for (const undoStep of undo.reverse()) await undoStep().catch(() => undefined);
    throw error;
  }
}

function expandWindowsPath(entry, env) {
  return entry.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? match : env[key];
  });
}

async function warnIfSystemPathShadows(ctx, state) {
  if (ctx.platform !== 'win32') return;
  let systemPath;
  try {
    systemPath = await ctx.readSystemPath();
  } catch {
    return;
  }
  const userPath = await ctx.readUserPath();
  const entries = [...splitWindowsPath(systemPath), ...splitWindowsPath(userPath)]
    .map((entry) => expandWindowsPath(entry, ctx.env));
  const wrapperIndex = entries.findIndex((entry) => windowsPathHasEntry(entry, state.wrapperDir));
  const realIndex = entries.findIndex((entry) => windowsPathHasEntry(entry, dirname(state.realKimi)));
  if (realIndex !== -1 && (wrapperIndex === -1 || realIndex < wrapperIndex)) {
    ctx.error(
      'WARNING: the official kimi is earlier in the effective Windows PATH (usually the System PATH), ' +
      'so takeover is not active. Add the wrapper directory to the System PATH before kimi, or adjust PATH order: ' +
      state.wrapperDir,
    );
  }
}

function successLines(state, platform) {
  const lines = [
    `open-kimi-web integration wrappers installed in: \`${state.wrapperDir}\`.`,
    `real kimi: ${state.realKimi} (${state.realKimiVersion})`,
    platform === 'win32'
      ? 'Open a NEW terminal (the user PATH was updated); the current one keeps the old PATH.'
      : 'Open a new shell or run `hash -r`; the current shell may cache the old kimi path.',
  ];
  return lines;
}

export function makeContext(options) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  return {
    env,
    platform,
    paths: integrationPaths(integrationHome(env)),
    log: options.log ?? console.log,
    error: options.error ?? console.error,
    run: options.run,
    readUserPath: options.readUserPath ?? (() => readWindowsUserPath(options.run)),
    readSystemPath: options.readSystemPath ?? (() => readWindowsSystemPath(options.run)),
    writeUserPath: options.writeUserPath ?? ((value) => writeWindowsUserPath(value, options.run)),
  };
}

export async function installIntegration(options = {}) {
  const ctx = makeContext(options);
  return withIntegrationLock(ctx.paths.lockFile, async () => {
    const existing = await loadState(ctx.paths);
    if (existing.error !== undefined) {
      throw new IntegrateError(`${existing.error}; run \`open-kimi-web integrate repair\``);
    }
    if (existing.state !== null) {
      if (
        (await wrappersIntact(ctx.paths, existing.state)) &&
        (await pathInstallIntact(ctx))
      ) {
        ctx.log('open-kimi-web integration is already installed and intact (no changes).');
        return { code: 0, state: existing.state, changed: false };
      }
      if (await wrappersIntact(ctx.paths, existing.state)) {
        const state = await buildAndRecord(ctx, existing.state.installedAt);
        for (const line of successLines(state, ctx.platform)) ctx.log(line);
        await warnIfSystemPathShadows(ctx, state);
        return { code: 0, state, changed: true };
      }
      throw new IntegrateError(
        'a partial installation was detected; run `open-kimi-web integrate repair`',
      );
    }
    await detectExistingTrace(ctx);
    const state = await buildAndRecord(ctx, new Date().toISOString());
    for (const line of successLines(state, ctx.platform)) ctx.log(line);
    await warnIfSystemPathShadows(ctx, state);
    return { code: 0, state, changed: true };
  });
}

export async function repairIntegration(options = {}) {
  const ctx = makeContext(options);
  return withIntegrationLock(ctx.paths.lockFile, async () => {
    const existing = await loadState(ctx.paths);
    const installedAt = existing.state?.installedAt ?? new Date().toISOString();
    const state = await buildAndRecord(ctx, installedAt);
    ctx.log('open-kimi-web integration repaired: wrapper, PATH entry and state refreshed.');
    await warnIfSystemPathShadows(ctx, state);
    return { code: 0, state, changed: true };
  });
}

/** Remove exactly what install created; the official Kimi install, its
 *  config, sessions, plugins and the TLS certificate store are kept. */
export async function uninstallIntegration(options = {}) {
  const ctx = makeContext(options);
  return withIntegrationLock(ctx.paths.lockFile, async () => {
    const existing = await loadState(ctx.paths);
    const removed = [];
    if (ctx.platform === 'win32') {
      const current = await ctx.readUserPath();
      const next = removeWindowsPathEntry(current, ctx.paths.bin);
      if (next !== null) {
        await ctx.writeUserPath(next);
        removed.push('user PATH entry');
      }
    } else {
      const homeDir = ctx.env.HOME ?? ctx.env.USERPROFILE ?? '';
      for (const file of await removeRcBlocks(homeDir)) removed.push(`rc block in ${file}`);
    }
    for (const name of wrapperFileNames(ctx.platform)) {
      const file = join(ctx.paths.bin, name);
      if (await isOurWrapper(file)) {
        await rm(file, { force: true });
        removed.push(file);
      }
    }
    await rmdir(ctx.paths.bin).catch(() => undefined);
    await removeState(ctx.paths);
    removed.push('integration.json');
    if (existing.state === null) ctx.log('no state file; cleaned default wrapper locations only.');
    ctx.log(`open-kimi-web integration uninstalled (${removed.join(', ')}).`);
    ctx.log('kept: official kimi installation, its configuration, sessions, and the OpenWeb TLS certificates.');
    return { code: 0 };
  });
}
