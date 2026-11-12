import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { terminateTree } from '../update/treeCleanup.mjs';
import { recordProcessStart } from '../update/windowsTreeCleanup.mjs';

const READY = 'okw-restart-ready';

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export async function waitForParentExit(pid, options = {}) {
  const alive = options.alive ?? processAlive;
  const sleep = options.sleep ?? pause;
  for (let i = 0; i < 180; i += 1) {
    if (!alive(pid)) return;
    await sleep(250);
  }
  throw new Error('original-launcher-still-running');
}

export async function launchReplacement(command, options = {}) {
  const spawnImpl = options.spawn ?? spawn;
  const startedAt = Date.now() - 1;
  const child = spawnImpl(process.execPath, [...command.execArgv, ...command.args], {
    cwd: command.cwd, env: options.env ?? process.env, detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  recordProcessStart(child, startedAt);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (child.pid) await (options.terminate ?? terminateTree)(child, {});
        if (child.connected) child.disconnect();
        reject(new Error('replacement-startup-failed'));
      } catch { reject(new Error('replacement-cleanup-unconfirmed')); }
    };
    const timer = setTimeout(fail, 45000);
    child.on('error', fail);
    child.once('exit', fail);
    child.on('message', (message) => {
      if (settled || message?.type !== READY || message.port !== command.port) return;
      settled = true;
      clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.unref();
      resolve();
    });
  });
}

export async function restartWorker(command, options = {}) {
  await (options.wait ?? waitForParentExit)(options.parentPid ?? process.ppid);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await (options.launch ?? launchReplacement)(command, options); return; }
    catch (error) {
      if (error.message === 'replacement-cleanup-unconfirmed' || attempt === 1) throw error;
      await (options.sleep ?? pause)(1000);
    }
  }
}

function main() {
  let command;
  let committed = false;
  const parentPid = process.ppid;
  const exit = () => process.exit(0);
  const timer = setTimeout(exit, 20000);
  process.on('disconnect', () => { if (!committed) exit(); });
  process.on('message', (message) => {
    if (!message || committed) return;
    if (message.type === 'cancel') exit();
    if (message.type === 'prepare' && !command) {
      command = message.command;
      process.send({ type: 'prepared' });
    }
    if (message.type === 'commit' && command) {
      committed = true;
      clearTimeout(timer);
      process.send({ type: 'committed' });
      restartWorker(command, { parentPid }).then(exit, () => process.exit(1));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
