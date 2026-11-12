import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { processAlive } from '../../packages/launcher/src/restart/worker.mjs';
import { terminateTree } from '../../packages/launcher/src/update/treeCleanup.mjs';
import { recordProcessStart } from '../../packages/launcher/src/update/windowsTreeCleanup.mjs';

it('keeps the replacement server alive after its detached restart worker exits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'okw-restart-worker-'));
  const childPath = join(dir, 'server.mjs'); const statusPath = join(dir, 'status.json');
  const parentPath = join(dir, 'worker.mjs');
  const probe = createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  let parent; let status;
  try {
    await writeFile(childPath, `
      import {createServer} from 'node:http';
      import {writeFileSync} from 'node:fs';
      const server=createServer((req,res)=>res.end('fictional-replacement'));
      server.listen(${port},'127.0.0.1',()=>{
        writeFileSync(${JSON.stringify(statusPath)},JSON.stringify({pid:process.pid,created:Date.now()}));
        process.send({type:'okw-restart-ready',port:${port}});
      });
    `);
    const workerUrl = new URL('../../packages/launcher/src/restart/worker.mjs', import.meta.url).href;
    await writeFile(parentPath, `
      import {launchReplacement} from ${JSON.stringify(workerUrl)};
      await launchReplacement(${JSON.stringify({ cwd: dir, execArgv: [], args: [childPath], port })});
      process.exit(0);
    `);
    parent = spawn(process.execPath, [parentPath], { detached: true, stdio: 'ignore', windowsHide: true });
    recordProcessStart(parent, Date.now() - 1000);
    const code = await new Promise((resolve, reject) => { parent.once('exit', resolve); parent.once('error', reject); });
    expect(code).toBe(0); status = JSON.parse(await readFile(statusPath, 'utf8'));
    await delay(200);
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
    expect(await response.text()).toBe('fictional-replacement'); expect(processAlive(status.pid)).toBe(true);
  } finally {
    status ??= await readFile(statusPath, 'utf8').then(JSON.parse).catch(() => undefined);
    if (status && processAlive(status.pid)) {
      const child = { pid: status.pid, exitCode: null, signalCode: null };
      recordProcessStart(child, status.created - 1000); await terminateTree(child);
    }
    if (parent?.pid && parent.exitCode === null && processAlive(parent.pid)) await terminateTree(parent);
    await rm(dir, { recursive: true, force: true });
  }
});
