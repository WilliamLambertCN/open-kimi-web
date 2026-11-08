import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultHome } from '../tlsStore.mjs';

export function localCaPaths(home = defaultHome()) {
  const tlsDir = join(home, 'tls');
  const dir = join(tlsDir, 'local-ca');
  return {
    home, tlsDir, dir,
    rootKey: join(dir, 'root.key'),
    rootCert: join(dir, 'root.crt'),
    leafKey: join(dir, 'server.key'),
    leafCert: join(dir, 'server.crt'),
    marker: join(dir, 'enabled.json'),
    lock: join(dir, '.operation.lock'),
  };
}

async function info(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function localCaStorageExists(paths) {
  return Boolean(await info(paths.dir));
}

export async function readLocalCaFile(path) {
  const entry = await info(path);
  if (!entry) return null;
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Local CA storage must contain regular files only.');
  if (entry.size > 64 * 1024) throw new Error('Local CA storage file exceeds its size limit.');
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function assertLocalCaDirectories(paths, create = false) {
  for (const path of [paths.home, paths.tlsDir, paths.dir]) {
    const entry = await info(path);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error('Local CA storage directories must not be symbolic links.');
    }
    if (!entry && create) await mkdir(path, { recursive: true, mode: 0o700 });
  }
  if (create && process.platform !== 'win32') await chmod(paths.dir, 0o700);
}

export async function atomicLocalCaWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    if (process.platform !== 'win32') await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function acquireLock(paths, options) {
  const deadline = Date.now() + (options.lockTimeoutMs ?? 10_000);
  for (;;) {
    try {
      return await open(paths.lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('Timed out waiting for Local CA operation lock; check for another active operation.'), {
          code: 'ELOCALCALOCKTIMEOUT',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, options.lockPollMs ?? 50));
    }
  }
}

export async function withLocalCaLock(paths, options, action) {
  await assertLocalCaDirectories(paths, true);
  const handle = await acquireLock(paths, options);
  try {
    return await action();
  } finally {
    await handle.close();
    await rm(paths.lock, { force: true });
  }
}
