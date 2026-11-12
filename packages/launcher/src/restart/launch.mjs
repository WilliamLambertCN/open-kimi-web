import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));

export function restartCommand(web, argv = process.argv) {
  const args = [...argv.slice(1)];
  if (!args[0] || args[1] !== '__wrap' || args[2] !== 'web') throw new Error('restart-entry-unavailable');
  if (!args.includes('--no-open')) args.push('--no-open');
  if (web.port === 0) throw new Error('restart-requires-fixed-port');
  return { args, execArgv: [...process.execArgv], cwd: process.cwd(), port: web.port ?? 48627 };
}

function disconnect(child) {
  try { if (child.connected) child.disconnect(); } catch {}
}

function send(child, message, callback) {
  try { child.send(message, callback); } catch { callback?.(new Error('restart-ipc-closed')); }
}

function commitWorker(child) {
  if (!child.connected || child.exitCode !== null) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', acknowledged); child.off('exit', failed); child.off('error', failed);
      if (ok) { disconnect(child); child.unref(); }
      resolve(ok);
    };
    const acknowledged = (message) => { if (message?.type === 'committed') done(true); };
    const failed = () => done(false);
    const timer = setTimeout(failed, 3000);
    child.on('message', acknowledged); child.once('exit', failed); child.once('error', failed);
    send(child, { type: 'commit' }, (error) => { if (error) failed(); });
  });
}

export async function prepareRestart(command, options = {}) {
  const child = (options.fork ?? fork)(WORKER, [], {
    cwd: command.cwd, env: options.env ?? process.env, detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => {
      if (child.connected) send(child, { type: 'cancel' }, () => {});
      disconnect(child); child.unref();
    };
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); cancel(); reject(new Error('restart-worker-unavailable'));
    };
    const timer = setTimeout(fail, 8000);
    child.on('error', fail);
    child.once('exit', fail);
    child.on('message', (message) => {
      if (message?.type !== 'prepared' || settled) return;
      settled = true; clearTimeout(timer);
      resolve({ cancel, commit: () => commitWorker(child) });
    });
    child.once('spawn', () => send(child, { type: 'prepare', command }, (error) => { if (error) fail(); }));
  });
}
