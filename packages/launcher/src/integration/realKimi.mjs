// Resolve the REAL `kimi` executable before the wrapper goes onto PATH.
// Sources, in order: OPEN_KIMI_REAL_KIMI (explicit override), then a PATH
// scan. Anything that resolves back into our own wrapper directory is
// skipped, so a half-installed wrapper can never be picked as "real".
import { realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';

import { IntegrateError } from './state.mjs';
import { runCapture } from './proc.mjs';

export function kimiCandidateNames(platform) {
  return platform === 'win32' ? ['kimi.exe', 'kimi.cmd', 'kimi.bat', 'kimi'] : ['kimi'];
}

export async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function isExecutableFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** True when `candidate` lives inside `wrapperDir` (same realpath root). */
export async function isInsideWrapperDir(candidate, wrapperDir) {
  const root = await canonicalPath(wrapperDir);
  const target = await canonicalPath(candidate);
  return target === root || target.startsWith(`${root}${sep}`);
}

async function verifyCandidate(path, options) {
  const run = options.run ?? runCapture;
  const result = await run(path, ['--version'], { timeoutMs: options.timeoutMs });
  const version = result.stdout.trim().split('\n')[0]?.trim() ?? '';
  if (result.code !== 0 || version === '') {
    throw new IntegrateError(`kimi at ${path} did not answer --version`);
  }
  if (/open-kimi-web/i.test(version)) {
    throw new IntegrateError(`kimi at ${path} looks like the open-kimi-web wrapper itself`);
  }
  return version;
}

function pathEntries(env, platform) {
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  const sep = platform === 'win32' ? ';' : delimiter;
  return raw.split(sep).filter((entry) => entry !== '');
}

function collectCandidates(env, platform) {
  const override = env.OPEN_KIMI_REAL_KIMI;
  if (override !== undefined && override !== '') {
    return { override: true, list: [isAbsolute(override) ? override : resolve(override)] };
  }
  const list = [];
  for (const dir of pathEntries(env, platform)) {
    for (const name of kimiCandidateNames(platform)) list.push(join(dir, name));
  }
  return { override: false, list };
}

async function tryCandidate(candidate, wrapperDir, options, strict) {
  if (!(await isExecutableFile(candidate))) return null;
  if (wrapperDir !== undefined && (await isInsideWrapperDir(candidate, wrapperDir))) return null;
  try {
    const version = await verifyCandidate(candidate, options);
    return { path: await canonicalPath(candidate), version };
  } catch (error) {
    if (strict) throw error;
    // A broken PATH entry must not hide a later, working kimi.
    return null;
  }
}

/**
 * Find and verify the real kimi. Throws IntegrateError when nothing usable
 * is found or the resolution would recurse into the wrapper.
 * options: { env, platform, wrapperDir, run, timeoutMs }
 */
export async function resolveRealKimi(options) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const { override, list } = collectCandidates(env, platform);
  for (const candidate of list) {
    const found = await tryCandidate(candidate, options.wrapperDir, options, override);
    if (found !== null) return found;
  }
  throw new IntegrateError(
    override
      ? `OPEN_KIMI_REAL_KIMI does not point at a working kimi: ${env.OPEN_KIMI_REAL_KIMI}`
      : 'could not find the official kimi on PATH (set OPEN_KIMI_REAL_KIMI to its path)',
  );
}
