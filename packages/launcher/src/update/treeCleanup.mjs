import { spawn } from 'node:child_process';
import { join } from 'node:path';

export function unconfirmedCleanup(message) {
  return Object.assign(new Error(message), { code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
}

function groupSignal(pid, signal, kill) {
  try { kill(-pid, signal); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopGroup(pid, options) {
  const kill = options.kill ?? process.kill;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!groupSignal(pid, 'SIGTERM', kill)) return;
  for (let elapsed = 0; elapsed < 1_000; elapsed += 50) {
    await wait(50);
    if (!groupSignal(pid, 0, kill)) return;
  }
  groupSignal(pid, 'SIGKILL', kill);
}

function stopWindowsTree(child, options) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw unconfirmedCleanup('parent already exited; refusing taskkill on an exited or reusable PID; descendants unconfirmed');
  }
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe');
    const killer = (options.spawn ?? spawn)(executable, ['/PID', String(child.pid), '/T', '/F'], {
      shell: false, windowsHide: true,
    });
    const timer = setTimeout(() => {
      killer.kill();
      reject(unconfirmedCleanup('taskkill timed out; child-tree cleanup could not be verified'));
    }, 3_000);
    killer.on('error', (error) => { clearTimeout(timer); reject(error); });
    killer.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(unconfirmedCleanup(`taskkill failed (${code}); child-tree cleanup unconfirmed`));
    });
  });
}

export async function terminateTree(child, options = {}) {
  if (!child.pid) return;
  try {
    if ((options.platform ?? process.platform) === 'win32') await stopWindowsTree(child, options);
    else await stopGroup(child.pid, options);
  } catch (error) {
    throw unconfirmedCleanup(error.message);
  }
}
