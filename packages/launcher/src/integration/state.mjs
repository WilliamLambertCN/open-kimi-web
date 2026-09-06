// Integration state: where the `kimi web` takeover keeps its own files and
// the integration.json record. Everything lives under one state home
// (OPEN_KIMI_WEB_HOME, default ~/.open-kimi-web) — the official Kimi
// installation is never written to.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const INTEGRATION_SCHEMA = 1;

export class IntegrateError extends Error {}

export function integrationHome(env = process.env) {
  const base = env.OPEN_KIMI_WEB_HOME || env.HOME || env.USERPROFILE || homedir();
  return env.OPEN_KIMI_WEB_HOME || join(base, '.open-kimi-web');
}

export function integrationPaths(home = integrationHome()) {
  return {
    home,
    bin: join(home, 'bin'),
    stateFile: join(home, 'integration.json'),
    lockFile: join(home, '.integrate.lock'),
  };
}

export function makeState(fields) {
  return {
    schema: INTEGRATION_SCHEMA,
    realKimi: fields.realKimi,
    realKimiVersion: fields.realKimiVersion,
    node: fields.node,
    wrapperDir: fields.wrapperDir,
    wrapperFiles: fields.wrapperFiles,
    pathInstall: fields.pathInstall,
    installedAt: fields.installedAt,
    launcherVersion: fields.launcherVersion,
  };
}

/** Missing file → { state: null }; unreadable/corrupt → { state: null, error }. */
export async function loadState(paths) {
  let raw;
  try {
    raw = await readFile(paths.stateFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: null };
    return { state: null, error: `cannot read state file: ${error.message}` };
  }
  try {
    const state = JSON.parse(raw);
    if (state?.schema !== INTEGRATION_SCHEMA || typeof state.realKimi !== 'string') {
      return { state: null, error: 'state file has an unsupported schema' };
    }
    return { state };
  } catch {
    return { state: null, error: 'state file is corrupt' };
  }
}

export async function saveState(paths, state) {
  const temporary = `${paths.stateFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(makeState(state), null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, paths.stateFile);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function removeState(paths) {
  await rm(paths.stateFile, { force: true });
}
