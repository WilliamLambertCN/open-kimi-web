import { spawn } from 'node:child_process';
import { terminateTree, unconfirmedCleanup } from './treeCleanup.mjs';

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_LIMIT = 256 * 1024;

export function runProcess(command, args = [], options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT, maxBytes = DEFAULT_LIMIT, signal, platform = process.platform } = options;
  if (signal?.aborted) return Promise.reject(new Error('update command cancelled before start'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env ?? process.env, shell: false, windowsHide: true,
      detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state = { stdout: '', stderr: '', bytes: 0, failure: null, killTask: null };
    let grace;
    const abort = (message) => {
      if (state.failure) return;
      state.failure = new Error(message);
      state.killTask = Promise.resolve().then(() => (options.terminateTree ?? terminateTree)(child, { platform }))
        .catch((error) => error);
      const abandon = (reason) => {
        cleanup();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reject(unconfirmedCleanup(`${message}; ${reason}`));
      };
      state.killTask.then((error) => { if (error) abandon(error.message); });
      grace = setTimeout(() => abandon('child tree did not close; descendants cannot be guaranteed stopped'), 5_000);
    };
    const cancelled = () => abort('update command cancelled');
    const timer = setTimeout(() => abort(`update command timed out after ${timeoutMs}ms`), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', cancelled);
    };
    const collect = (key) => (chunk) => {
      state.bytes += chunk.length;
      if (state.bytes > maxBytes) { abort(`update command exceeded ${maxBytes} output bytes`); return; }
      state[key] += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', async (code, exitSignal) => {
      cleanup();
      const killError = await state.killTask;
      if (killError) return reject(unconfirmedCleanup(`${state.failure.message}; ${killError.message}`));
      if (state.failure) return reject(state.failure);
      resolve({ code, signal: exitSignal, stdout: state.stdout, stderr: state.stderr });
    });
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
  });
}

export async function checkedRun(command, args, options) {
  const result = await runProcess(command, args, options);
  if (result.code !== 0) {
    throw new Error(`update command failed (${result.code}): ${result.stderr.trim().slice(0, 2_000)}`);
  }
  return result.stdout.trim();
}
