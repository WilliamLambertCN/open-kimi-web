import { spawn } from 'node:child_process';
import { connect } from 'node:net';
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

function addressReleased(address) {
  return new Promise((resolve) => {
    const socket = connect({ host: address.host, port: address.port });
    const done = (released) => { socket.destroy(); resolve(released); };
    socket.once('connect', () => done(false));
    socket.once('error', (error) => done(error.code === 'ECONNREFUSED'));
    socket.setTimeout(500, () => done(false));
  });
}

async function waitForBackendExit(backend, alive, sleep) {
  if (!backend) return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!alive(backend.pid)) return;
    await sleep(100);
  }
  throw new Error('original-backend-still-running');
}

function replacementAddresses(command) {
  const addresses = [{ host: command.host ?? '127.0.0.1', port: command.port }];
  if (command.backend) addresses.push(command.backend);
  return addresses;
}

export async function waitForReplacementSlots(command, options = {}) {
  const { alive = processAlive, released = addressReleased, sleep = pause } = options;
  await waitForBackendExit(command.backend, alive, sleep);
  const addresses = replacementAddresses(command);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await Promise.all(addresses.map(released))).every(Boolean)) return;
    await sleep(100);
  }
  throw new Error('restart-address-in-use');
}

export async function restartWorker(command, options = {}) {
  const { wait = waitForParentExit, slots = waitForReplacementSlots, launch = launchReplacement,
    parentPid = process.ppid, sleep = pause } = options;
  await wait(parentPid);
  await slots(command, options);
  await launchWithRetry(command, { launch, sleep, options });
}

async function launchWithRetry(command, { launch, sleep, options }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await launch(command, options); return; }
    catch (error) {
      if (error.message === 'replacement-cleanup-unconfirmed' || attempt === 1) throw error;
      await sleep(1000);
    }
  }
}

export function runRestartWorker(channel = process, options = {}) {
  let command;
  let committed = false;
  let canceled = false;
  const parentPid = options.parentPid ?? process.ppid;
  const exit = (code = 0) => { clearTimeout(timer); (options.exit ?? process.exit)(code); };
  const timer = setTimeout(() => exit(), 20000);
  const start = () => {
    clearTimeout(timer);
    (options.restart ?? restartWorker)(command, { parentPid }).then(() => exit(), () => exit(1));
  };
  channel.on('disconnect', () => { if (committed && !canceled) start(); else exit(); });
  channel.on('message', (message) => {
    if (message?.type === 'cancel') { canceled = true; clearTimeout(timer); exit(); return; }
    if (message?.type === 'prepare' && !command) {
      command = message.command;
      channel.send({ type: 'prepared' });
    }
    if (message?.type === 'commit' && command && !committed) {
      committed = true;
      clearTimeout(timer);
      channel.send({ type: 'committed' }, () => {});
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runRestartWorker();
