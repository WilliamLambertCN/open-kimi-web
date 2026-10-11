import { createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function acquireInstallerUpdateLock(ctx, existing) {
  if (existing) {
    const module = await import(pathToFileURL(join(ctx.root, 'src/update/lock.mjs')).href);
    return module.acquireLock({ prefix: ctx.prefix });
  }
  const target = ctx.platform === 'win32' ? resolve(ctx.prefix).toLowerCase() : resolve(ctx.prefix);
  const digest = createHash('sha256').update(target).digest('hex').slice(0, 32);
  const file = join(tmpdir(), `open-kimi-web-update-${digest}.lock`);
  try { await mkdir(file, { mode: 0o700 }); }
  catch { throw new Error('this installation already has an update lock; check the owning updater first'); }
  try {
    const handle = await open(join(file, 'owner'), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
    finally { await handle.close(); }
  } catch (error) {
    await rm(file, { recursive: true, force: true });
    throw error;
  }
  return () => rm(file, { recursive: true, force: true });
}
