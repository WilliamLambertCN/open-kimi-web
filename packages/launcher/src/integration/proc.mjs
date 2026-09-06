// Process helpers for the integration layer: capture a short command's
// output (with a hard timeout) and mirror a long-running child's stdio,
// exit code and signals. All injectable so tests never touch the real PATH.
import { spawn } from 'node:child_process';

export const DEFAULT_RUN_TIMEOUT_MS = 5_000;

const CMD_SCRIPT_RE = /\.(cmd|bat)$/i;

export function isWindowsCmdScript(cmd, platform = process.platform) {
  return platform === 'win32' && CMD_SCRIPT_RE.test(cmd);
}

/** Quote one token for a cmd.exe /c command line: wrap in double quotes when
 *  it is empty or contains whitespace or cmd metacharacters. */
function cmdQuote(value) {
  return value === '' || /[\s"&|<>()^%]/.test(value) ? `"${value}"` : value;
}

/** Resolve how `cmd args` must actually be spawned. On win32 a .cmd/.bat
 *  cannot be spawned directly (EINVAL since the Node security fix), so it is
 *  routed through cmd.exe /d /c with a single quoted command line. The outer
 *  quotes are required: cmd strips the first and last quote and parses the
 *  rest. No /s — with /s cmd keeps the outer quotes and treats the whole
 *  line as the executable name. `verbatim` must be passed as
 *  windowsVerbatimArguments: Node's default msvcrt escaping produces \"
 *  sequences, but cmd.exe reads /c text from the raw command line and takes
 *  them literally. */
export function resolveSpawnTarget(cmd, args, platform = process.platform) {
  if (!isWindowsCmdScript(cmd, platform)) {
    return { cmd, args, verbatim: false };
  }
  const line = [cmd, ...args].map(cmdQuote).join(' ');
  return { cmd: 'cmd.exe', args: ['/d', '/c', `"${line}"`], verbatim: true };
}

/** Run `cmd args`, capture output, resolve on exit; rejects on spawn error
 *  or timeout (the child is killed on timeout). */
export function runCapture(cmd, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child;
    try {
      const target = resolveSpawnTarget(cmd, args, options.platform);
      child = spawn(target.cmd, target.args, {
        env: options.env,
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: options.shell === true,
        windowsVerbatimArguments: target.verbatim,
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timed out running: ${cmd}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Spawn `cmd args` with inherited stdio, forward SIGINT/SIGTERM to the
 *  child, and resolve with the child's exit code (1 when killed by a
 *  non-forwarded signal). */
export function spawnMirror(cmd, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const target = resolveSpawnTarget(cmd, args, platform);
  const child = spawn(target.cmd, target.args, {
    env: options.env ?? process.env,
    cwd: options.cwd,
    stdio: 'inherit',
    shell: options.shell === true,
    windowsVerbatimArguments: target.verbatim,
  });
  const forward = (signal) => {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  };
  const onSigint = () => forward('SIGINT');
  const onSigterm = () => forward('SIGTERM');
  const shouldForward = platform !== 'win32';
  if (shouldForward) {
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  }
  const removeSignalListeners = () => {
    if (!shouldForward) return;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  };
  const exited = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      removeSignalListeners();
      reject(error);
    });
    child.on('exit', (code, signal) => {
      removeSignalListeners();
      resolve({ code, signal });
    });
  });
  return { child, exited };
}
