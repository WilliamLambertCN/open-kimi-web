import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { terminateTree } from '../../packages/launcher/src/update/treeCleanup.mjs';
import { recordProcessStart } from '../../packages/launcher/src/update/windowsTreeCleanup.mjs';

const children = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});

function liveChild() {
  const child = spawn(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)']);
  children.push(child);
  return child;
}

describe.skipIf(process.platform !== 'win32')('Windows native updater ownership checks', () => {
  it('refuses a real live process whose creation time is outside the recorded spawn window', async () => {
    const child = liveChild();
    await once(child.stdout, 'data');
    recordProcessStart(child, Date.now() + 60_000);
    await expect(terminateTree(child)).rejects.toMatchObject({ cleanupUnconfirmed: true });
    expect(child.exitCode).toBeNull();
    expect(() => process.kill(child.pid, 0)).not.toThrow();
  });

  it('refuses a root that exited before the native helper opens it and leaves an independent process running', async () => {
    const child = liveChild();
    await once(child.stdout, 'data');
    const independent = liveChild();
    await once(independent.stdout, 'data');
    const identity = { pid: child.pid, exitCode: null, signalCode: null };
    recordProcessStart(identity, Date.now() - 60_000);
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await expect(terminateTree(identity)).rejects.toMatchObject({ cleanupUnconfirmed: true });
    expect(independent.exitCode).toBeNull();
    expect(() => process.kill(independent.pid, 0)).not.toThrow();
  });
});
