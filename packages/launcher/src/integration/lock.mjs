// Tiny mutual-exclusion lock for integration state writes (same O_EXCL
// pattern as the TLS store, kept generic here so install/repair/uninstall
// share it).
import { constants } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_STALE_MS = 60_000;

async function removeIfStale(path, staleMs) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs <= staleMs) return false;
    await rm(path, { force: true });
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function acquire(path, options) {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await removeIfStale(path, options.staleMs)) continue;
      if (Date.now() >= deadline) throw new Error('timed out waiting for the integration lock');
      await new Promise((resolve) => setTimeout(resolve, options.pollMs));
    }
  }
}

export async function withIntegrationLock(lockFile, action, options = {}) {
  const opts = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    staleMs: options.staleMs ?? DEFAULT_STALE_MS,
  };
  await mkdir(dirname(lockFile), { recursive: true });
  await acquire(lockFile, opts);
  try {
    return await action();
  } finally {
    await rm(lockFile, { force: true });
  }
}
