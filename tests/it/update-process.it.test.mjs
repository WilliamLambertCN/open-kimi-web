import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { checkedRun, runProcess } from '../../packages/launcher/src/update/process.mjs';
import { updateMain } from '../../packages/launcher/src/update/updateMain.mjs';
import { acquireLock } from '../../packages/launcher/src/update/lock.mjs';
import { exists } from '../../packages/launcher/src/update/files.mjs';
import { put } from './updateFixture.mjs';

const directories = [];
const cleanup = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'okw-update-owned-tree-'));
  directories.push(directory);
  const script = join(directory, 'child.cjs');
  await put(script, 'const fs=require("fs");fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);');
  const parent = join(directory, 'parent.cjs');
  await put(parent, 'const {spawn}=require("child_process");spawn(process.execPath,[process.argv[2],process.argv[3]],' +
    '{stdio:"inherit"});setInterval(()=>{},1000);');
  return { directory, script, parent, pidFile: join(directory, 'owned.pid') };
}
async function waitPid(path) {
  for (let count = 0; count < 100; count += 1) {
    try { return Number(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('fixture child did not write PID');
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopFixturePid(pid) {
  if (alive(pid)) {
    if (process.platform === 'win32') {
      await checkedRun(join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(pid), '/F']);
    } else process.kill(pid, 'SIGKILL');
  }
  for (let count = 0; count < 100 && alive(pid); count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(alive(pid)).toBe(false);
}

async function exitedParentCommand(value) {
  if (process.platform === 'win32') {
    const quote = (text) => `'${text.replaceAll("'", "''")}'`;
    const command = `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ` +
      `${quote(`"${value.script}"`)},${quote(`"${value.pidFile}"`)} -NoNewWindow; exit 0`;
    return { command: join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')] };
  }
  await put(value.parent, 'const {spawn}=require("child_process");' +
    'spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:"inherit"}).unref();' +
    'setTimeout(()=>process.exit(0),100);');
  return { command: process.execPath, args: [value.parent, value.script, value.pidFile] };
}

async function independentFixture(value) {
  const path = join(value.directory, 'independent.pid');
  const child = spawn(process.execPath, [value.script, path], { shell: false, stdio: 'ignore' });
  cleanup.push(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const pid = await waitPid(path);
  const server = createServer((req, res) => res.end('unrelated-service'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const sentinel = join(value.directory, 'official-data-sentinel');
  await put(sentinel, 'unchanged');
  return { pid, url: `http://127.0.0.1:${server.address().port}`, sentinel };
}

describe('owned updater tree cleanup does not touch independent services', () => {
  it.each(['timeout', 'cancel'])('stops only its live subtree on %s, preserving independent state', async (mode) => {
    const value = await fixture();
    const independentFile = join(value.directory, 'independent.pid');
    const independent = spawn(process.execPath, [value.script, independentFile], { shell: false, stdio: 'ignore' });
    cleanup.push(async () => {
      if (independent.exitCode === null) { independent.kill(); await once(independent, 'exit'); }
    });
    const independentPid = await waitPid(independentFile);
    const sentinel = join(value.directory, 'official-data-sentinel');
    await put(sentinel, 'unchanged');
    const server = createServer((req, res) => res.end('unrelated-service'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}`;
    const controller = new AbortController();
    const task = runProcess(process.execPath, [value.parent, value.script, value.pidFile], {
      timeoutMs: mode === 'timeout' ? 1_000 : 5_000, signal: controller.signal,
    });
    const failure = expect(task).rejects.toThrow(mode === 'timeout' ? 'timed out' : 'cancelled');
    const ownedPid = await waitPid(value.pidFile);
    if (mode === 'cancel') controller.abort();
    await failure;
    for (let count = 0; count < 100 && alive(ownedPid); count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(alive(ownedPid)).toBe(false);
    expect(alive(independentPid)).toBe(true);
    expect(await (await fetch(url)).text()).toBe('unrelated-service');
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged');
  }, 10_000);

  it('handles a parent that exits while its worker holds stdout: Windows retains lock, POSIX cleans its group', async () => {
    const value = await fixture();
    const independent = await independentFixture(value);
    const parent = await exitedParentCommand(value);
    const target = { kind: 'global', root: join(value.directory, 'installed'), prefix: value.directory,
      version: '2.1.1-r9' };
    await put(join(target.root, 'package.json'), { version: target.version });
    const release = await acquireLock(target, { directory: value.directory });
    cleanup.push(() => release());
    let failure;
    const task = updateMain([], { identify: async () => target, acquireLock: async () => release,
      latestRelease: async () => ({ version: '2.1.1-r10', url: 'fixture-network-not-used' }),
      resolveTool: async () => ({ command: process.execPath, args: [] }), reidentify: async () => target,
      run: async () => {
        try { return await runProcess(parent.command, parent.args, { timeoutMs: 1_500 }); }
        catch (error) { failure = error; throw error; }
      }, log: () => {}, error: () => {},
    });
    const pid = await waitPid(value.pidFile);
    cleanup.push(() => stopFixturePid(pid));
    expect(await task).toBe(1);
    if (process.platform === 'win32') {
      expect(failure).toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
      expect(alive(pid)).toBe(true);
      expect(await exists(release.path)).toBe(true);
      await expect(acquireLock(target, { directory: value.directory })).rejects.toThrow('already has an update lock');
      await stopFixturePid(pid);
      await release();
    } else {
      expect(failure.cleanupUnconfirmed).not.toBe(true);
      expect(alive(pid)).toBe(false);
      expect(await exists(release.path)).toBe(false);
    }
    expect(alive(independent.pid)).toBe(true);
    expect(await (await fetch(independent.url)).text()).toBe('unrelated-service');
    expect(await readFile(independent.sentinel, 'utf8')).toBe('unchanged');
    expect(await exists(release.path)).toBe(false);
  }, 15_000);
});
