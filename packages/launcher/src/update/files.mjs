import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, isAbsolute } from 'node:path';

export async function readText(path, limit = 256 * 1024) {
  if ((await stat(path)).size > limit) throw new Error('update evidence file exceeds size limit');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new Error('update evidence file exceeds size limit');
  return text;
}

export async function readJson(path) {
  return JSON.parse(await readText(path, 2 * 1024 * 1024));
}

export async function exists(path) {
  try { await lstat(path); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function samePath(a, b, platform = process.platform) {
  const normalize = (value) => platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(a) === normalize(b);
}

export async function assertRealDirectory(path) {
  if ((await lstat(path)).isSymbolicLink() || !samePath(path, await realpath(path))) {
    throw new Error('linked or redirected installation directory is not supported');
  }
}

export function within(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(rel);
}
