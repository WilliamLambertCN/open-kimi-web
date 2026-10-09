import { createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function lockPath(installation, directory = tmpdir()) {
  let target = resolve(installation.repo ?? installation.owner ?? installation.prefix ?? installation.root);
  if (process.platform === 'win32') target = target.toLowerCase();
  const digest = createHash('sha256').update(target).digest('hex').slice(0, 32);
  return join(directory, `open-kimi-web-update-${digest}.lock`);
}

export async function acquireLock(installation, options = {}) {
  const path = lockPath(installation, options.directory);
  try { await mkdir(path, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('this installation already has an update lock; check the owning updater first');
    throw error;
  }
  try {
    const file = await open(join(path, 'owner'), 'wx', 0o600);
    await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await file.close();
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await rm(path, { recursive: true, force: true });
  };
  return Object.assign(release, { path });
}
